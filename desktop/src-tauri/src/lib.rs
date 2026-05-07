use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::MacosLauncher;

/// Send a native macOS notification. Blocks on a background thread until the
/// user interacts with it. If they click, opens the URL in the default browser.
#[tauri::command]
fn send_notification(title: String, body: String, url: String) {
    std::thread::spawn(move || {
        match mac_notification_sys::send_notification(&title, None, &body, None) {
            Ok(response) => {
                use mac_notification_sys::NotificationResponse::*;
                match response {
                    Click | ActionButton(_) => {
                        let _ = open::that(&url);
                    }
                    _ => {} // CloseButton, Reply, None — do nothing
                }
            }
            Err(e) => {
                eprintln!("[notification] failed to send: {e}");
            }
        }
    });
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
        .invoke_handler(tauri::generate_handler![send_notification])
        .setup(|app| {
            let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit SquadHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SquadHub desktop");
}
