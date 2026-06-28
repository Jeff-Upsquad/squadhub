use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_store::StoreExt;

mod notif;

const DEFAULT_QUICK_ADD_SHORTCUT: &str = "CommandOrControl+Shift+T";

/// (Re)register the global quick-add hotkey from an accelerator string, replacing
/// any previously registered shortcut. The handler shows + focuses the spotlight
/// "quickadd" window. Lives in Rust (not JS) so the hotkey keeps working while the
/// app sits in the tray with no window open.
#[cfg(desktop)]
fn apply_quick_add_shortcut(app: &tauri::AppHandle, accelerator: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(accelerator, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            show_quick_add(app);
        }
    })
    .map_err(|e| e.to_string())
}

/// Set + persist the quick-add hotkey (settings.json). Invoked from Settings.
#[tauri::command]
fn set_quick_add_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        apply_quick_add_shortcut(&app, &accelerator)?;
        let store = app.store("settings.json").map_err(|e| e.to_string())?;
        store.set("quick_add_shortcut", serde_json::json!(accelerator));
        store.save().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show + key the spotlight quick-add panel. It's a non-activating NSPanel
/// (converted at setup) so ⌘⇧T can summon it OVER another app's full-screen Space
/// and take keyboard focus WITHOUT activating our app — a plain NSWindow can't
/// become key over another app's full-screen Space, which is why earlier attempts
/// with collectionBehavior/level alone didn't show.
fn show_quick_add(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("quickadd") {
            panel.show();
            panel.make_key_and_order_front(None);
            qa_log("showed quick-add panel");
            return;
        }
        qa_log("quick-add panel not registered; falling back to window show");
    }
    if let Some(window) = app.get_webview_window("quickadd") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Tiny append-only debug log (mirrors notif.rs) so we can confirm the overlay
/// path actually ran: `tail -f /tmp/sh-quickadd.log`.
#[cfg(target_os = "macos")]
fn qa_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/sh-quickadd.log")
    {
        let _ = writeln!(f, "{msg}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![notif::send_notification, set_quick_add_shortcut])
        .setup(|app| {
            // Set up UNUserNotificationCenter delegate for click handling
            notif::setup();

            let quick_add_i = MenuItem::with_id(app, "quick_add", "Quick add task", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit SquadHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quick_add_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick_add" => {
                        show_quick_add(app);
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Global quick-add hotkey: shows the spotlight-style capture window
            // from anywhere, even while the app sits in the tray. Registered in
            // Rust so it survives the main window being closed/hidden; the
            // accelerator is stored in settings.json and editable from Settings.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

                let accel = app
                    .store("settings.json")
                    .ok()
                    .and_then(|s| s.get("quick_add_shortcut"))
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| DEFAULT_QUICK_ADD_SHORTCUT.to_string());

                if let Err(e) = apply_quick_add_shortcut(app.handle(), &accel) {
                    eprintln!("Quick-add shortcut '{accel}' failed to register ({e}); using default");
                    let _ = apply_quick_add_shortcut(app.handle(), DEFAULT_QUICK_ADD_SHORTCUT);
                }
            }

            // Convert the quick-add window into a non-activating NSPanel so ⌘⇧T can
            // summon it over another app's full-screen Space and take key focus
            // without activating our app (which would switch Spaces).
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::NSWindowCollectionBehavior;
                use tauri_nspanel::WebviewWindowExt;
                if let Some(window) = app.get_webview_window("quickadd") {
                    match window.to_panel() {
                        Ok(panel) => {
                            // NSWindowStyleMaskNonActivatingPanel (1<<7): take key
                            // focus without activating the app (no Space switch).
                            panel.set_style_mask(1 << 7);
                            panel.set_collection_behaviour(
                                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
                            );
                            // NSMainMenuWindowLevel + 1: above full-screen content.
                            panel.set_level(25);
                            qa_log("converted quick-add window to NSPanel");
                        }
                        Err(e) => qa_log(&format!("to_panel() failed: {e:?}")),
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SquadHub desktop");
}
