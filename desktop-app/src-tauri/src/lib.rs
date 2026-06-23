use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_updater::UpdaterExt;

/// Best-effort auto-update on launch (mirrors the companion): if a newer signed
/// build is published to the updater endpoint, download + install it and relaunch.
/// Silently no-ops when up to date or offline.
async fn try_update(app: tauri::AppHandle) {
    if let Ok(updater) = app.updater() {
        if let Ok(Some(update)) = updater.check().await {
            if update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .is_ok()
            {
                app.restart();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // Closing the window hides it to the tray instead of quitting, so the
        // page keeps running (socket alive) and notifications keep firing. Quit
        // from the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // Tray with Open / Quit.
            let open_i = MenuItem::with_id(app, "open", "Open SquadHub", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit SquadHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let icon = Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("SquadHub")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Check for updates on launch (best-effort, off the main thread).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(try_update(handle));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building SquadHub");

    app.run(|_app_handle, _event| {
        // macOS: clicking the Dock icon after the window was closed/hidden
        // should bring it back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = &_event {
            show_main(_app_handle);
        }
    });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
