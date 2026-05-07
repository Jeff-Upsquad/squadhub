fn main() {
    // Link UserNotifications framework so UNUserNotificationCenter is available
    // at runtime via objc::class!() calls in notif.rs.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=UserNotifications");

    tauri_build::build()
}
