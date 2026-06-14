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
            if let Some(window) = app.get_webview_window("quickadd") {
                let _ = window.show();
                let _ = window.set_focus();
            }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
                        if let Some(window) = app.get_webview_window("quickadd") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SquadHub desktop");
}
