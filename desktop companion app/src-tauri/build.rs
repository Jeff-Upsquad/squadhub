fn main() {
    // Link UserNotifications framework so UNUserNotificationCenter is available
    // at runtime via objc::class!() calls in notif.rs.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=UserNotifications");

    // Keep Spotlight from indexing cargo output so the bundled .app
    // doesn't show up as a second "SquadHub Companion" next to /Applications.
    #[cfg(target_os = "macos")]
    {
        let target_dir = std::env::var_os("CARGO_TARGET_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")
            });
        let _ = std::fs::create_dir_all(&target_dir);
        let _ = std::fs::write(target_dir.join(".metadata_never_index"), b"");
    }

    tauri_build::build()
}
