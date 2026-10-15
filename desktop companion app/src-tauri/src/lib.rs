use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
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
    // Keep the full-width creation surface attached to the active screen's top edge.
    if let Some(window) = app.get_webview_window("quickadd") {
        if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
            let x = monitor.position().x
                + (monitor.size().width.saturating_sub(size.width) / 2) as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, monitor.position().y));
        }
    }
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSWindowCollectionBehavior;
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("quickadd") {
            // Re-assert the over-full-screen behaviour on EVERY show. After Space
            // transitions macOS can quietly drop a non-activating panel back onto
            // our home Space (so ⌘⇧T surfaces it on the desktop *behind* the
            // full-screen app, i.e. "nothing happened"). Re-applying these each
            // time keeps it floating over the active full-screen Space.
            // CanJoinAllSpaces | FullScreenAuxiliary — matches tauri-nspanel's
            // proven `fullscreen` example. We previously also OR'd in Stationary,
            // which is NOT in that example; on macOS 26 (Tahoe) the reworked
            // Spaces system appears to treat a Stationary panel as desktop-pinned
            // and drops it onto the home Space instead of floating over the active
            // full-screen Space. Dropped it here.
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
            );
            panel.set_level(25);
            // show() already does orderFrontRegardless + makeKeyWindow, which is
            // what lets a non-activating panel surface over ANOTHER app's
            // full-screen Space. Do NOT add makeKeyAndOrderFront: here — that
            // call activates ordering in a way that bounces us out of the
            // full-screen Space instead of floating over it.
            panel.show();
            qa_log("showed quick-add panel");
            // Tell the (persistent) webview it's being summoned so it resets the
            // form to a blank task. We can't rely on tauri://focus for this: a
            // non-activating NSPanel shown/hidden from Rust doesn't reliably emit
            // a focus-changed event on every re-summon, so the previous task
            // would otherwise still be sitting in the fields on the next open.
            if let Some(window) = app.get_webview_window("quickadd") {
                let _ = window.emit("quickadd:show", ());
            }
            return;
        }
        qa_log("quick-add panel not registered; falling back to window show");
    }
    if let Some(window) = app.get_webview_window("quickadd") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("quickadd:show", ());
    }
}

/// Tiny append-only debug log (mirrors notif.rs) so we can confirm the overlay
/// path actually ran: `tail -f /tmp/sh-quickadd.log`.
#[cfg(target_os = "macos")]
fn qa_log(msg: &str) {
    use std::io::Write;
    // Prefix each line with an epoch-millis timestamp so we can correlate a
    // "showed panel" with a "resigned key" that lands microseconds later — the
    // tell-tale of AppKit racing to hide a non-activating panel on show.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/sh-quickadd.log")
    {
        let _ = writeln!(f, "{ts} {msg}");
    }
}

/// Show the notch timer panel at the top-center of the screen. Like the quick-add
/// panel it's a non-activating NSPanel floating over the active Space (even another
/// app's full-screen Space), so the running timer can surface — on tray click or at
/// a 30-minute mark — without switching Spaces or activating our Accessory app.
/// Positioning + sizing (collapsed pill vs expanded panel) is done JS-side; this
/// just orders it front over whatever's on screen. Hiding is done JS-side with
/// `getCurrentWindow().hide()` (mirrors the quick-add panel).
fn show_notch(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSWindowCollectionBehavior;
        use tauri_nspanel::ManagerExt;
        if let Ok(panel) = app.get_webview_panel("notch") {
            // Re-assert over-full-screen behaviour on every show — macOS can drop a
            // non-activating panel back to the home Space after Space transitions.
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
            );
            panel.set_level(25);
            panel.show();
            if let Some(window) = app.get_webview_window("notch") {
                let _ = window.emit("notch:show", ());
            }
            return;
        }
    }
    if let Some(window) = app.get_webview_window("notch") {
        let _ = window.show();
        let _ = window.emit("notch:show", ());
    }
}

/// Toggle the notch panel from the menu-bar tray. When hidden it opens expanded
/// (the full "Timer" design the user clicked to see); when already visible it hides.
fn toggle_notch(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("notch") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            // Tell the webview to render the expanded panel before it surfaces.
            let _ = window.emit("notch:expand", ());
            show_notch(app);
        }
    }
}

/// JS-invokable: surface the notch panel (collapsed pill on timer start, or the
/// expanded panel at a 30-minute mark). The webview chooses the view via its own
/// state before calling this.
#[tauri::command]
fn notch_show(app: tauri::AppHandle) {
    show_notch(&app);
}

/// JS-invokable: open the quick-add spotlight (used by the notch "Add task" tab).
#[tauri::command]
fn quick_add_show(app: tauri::AppHandle) {
    show_quick_add(&app);
}

/// JS-invokable: set the menu-bar tray title to the live timer clock (e.g.
/// "● 1:23:45"), or clear it (None) when no timer is running — the icon stays.
#[tauri::command]
fn set_timer_title(app: tauri::AppHandle, title: Option<String>) {
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id("sh-tray") {
        let _ = tray.set_title(title.as_deref());
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
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            notif::send_notification,
            set_quick_add_shortcut,
            notch_show,
            quick_add_show,
            set_timer_title
        ])
        .setup(|app| {
            // Run as a menu-bar/tray companion (no Dock icon, no app-switcher
            // entry). REQUIRED for the quick-add panel to float over another
            // app's full-screen Space: a .Regular app owns its own Space and
            // macOS won't let its windows intrude on a full-screen Space, so the
            // panel silently fails to appear. Accessory has no managed Space, so
            // the CanJoinAllSpaces | FullScreenAuxiliary panel surfaces correctly.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Set up UNUserNotificationCenter delegate for click handling
            notif::setup();

            let open_timer_i = MenuItem::with_id(app, "open_timer", "Open timer", true, None::<&str>)?;
            let quick_add_i = MenuItem::with_id(app, "quick_add", "Quick add task", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit SquadHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_timer_i, &quick_add_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("sh-tray")
                // Menu-bar glyph: a monochrome template image so macOS tints it
                // automatically for light/dark menu bars. Without an explicit icon
                // the tray falls back to the app icon (a solid square). The live
                // timer clock is set as the tray TITLE (text beside this icon) from
                // JS via `set_timer_title`.
                .icon(tauri::include_image!("icons/icon.png"))
                .icon_as_template(true)
                .menu(&menu)
                // Left-click opens the notch timer; right-click (or control-click)
                // still shows the menu. A left click with a timer running is the
                // user's "click the menu-bar timer to see the full design" gesture.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_notch(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_timer" => {
                        let _ = app
                            .get_webview_window("notch")
                            .map(|w| w.emit("notch:expand", ()));
                        show_notch(app);
                    }
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
                use tauri_nspanel::{panel_delegate, WebviewWindowExt};
                if let Some(window) = app.get_webview_window("quickadd") {
                    match window.to_panel() {
                        Ok(panel) => {
                            // NSWindowStyleMaskNonActivatingPanel (1<<7): take key
                            // focus without activating the app (no Space switch).
                            panel.set_style_mask(1 << 7);
                            // CanJoinAllSpaces | FullScreenAuxiliary only — see the
                            // note in show_quick_add(); Stationary was dropped as it
                            // desktop-pins the panel on macOS 26 (Tahoe).
                            panel.set_collection_behaviour(
                                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
                            );
                            // NSMainMenuWindowLevel + 1: above full-screen content.
                            panel.set_level(25);

                            // Diagnostics: log key transitions so we can tell, from
                            // /tmp/sh-quickadd.log, WHETHER the panel is being hidden
                            // by AppKit right after show (resign-key immediately after
                            // "showed panel") vs. simply landing on the wrong Space.
                            let delegate = panel_delegate!(QuickAddPanelDelegate {
                                window_did_become_key,
                                window_did_resign_key
                            });
                            delegate.set_listener(Box::new(move |name: String| match name.as_str() {
                                "window_did_become_key" => qa_log("panel became key"),
                                "window_did_resign_key" => qa_log("panel resigned key"),
                                _ => {}
                            }));
                            panel.set_delegate(delegate);
                            // NSPanel defaults hidesOnDeactivate = YES. Our app is
                            // .Accessory and this panel is non-activating, so the app
                            // is NEVER the active app — with the default, AppKit races
                            // to hide the panel right after we order it front. On the
                            // plain desktop there's no deactivation event at show-time
                            // so it sticks; entering/over another app's full-screen
                            // Space generates activation churn that triggers the hide,
                            // which is why ⌘⇧T only *sometimes* surfaced over a
                            // full-screen app. Keep it visible regardless.
                            panel.set_hides_on_deactivate(false);
                            qa_log("converted quick-add window to NSPanel");
                        }
                        Err(e) => qa_log(&format!("to_panel() failed: {e:?}")),
                    }
                }

                // Convert the notch timer window into a non-activating NSPanel too,
                // so the running-timer pill / expanded panel can float over the
                // active Space (including another app's full-screen Space) without
                // activating our Accessory app. Same mask/behaviour/level as the
                // quick-add panel; sizing + top-center positioning is done JS-side.
                if let Some(window) = app.get_webview_window("notch") {
                    match window.to_panel() {
                        Ok(panel) => {
                            panel.set_style_mask(1 << 7); // NonActivatingPanel
                            panel.set_collection_behaviour(
                                NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                    | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
                            );
                            panel.set_level(25);
                            panel.set_hides_on_deactivate(false);
                            qa_log("converted notch window to NSPanel");
                        }
                        Err(e) => qa_log(&format!("notch to_panel() failed: {e:?}")),
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SquadHub desktop");
}
