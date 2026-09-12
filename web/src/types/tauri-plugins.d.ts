// Optional Tauri packages — only present inside the desktop app. Declared here
// so the web typecheck passes without adding Tauri deps to the web build.
declare module '@tauri-apps/plugin-opener' {
  export function openUrl(url: string): Promise<void>;
}
declare module '@tauri-apps/plugin-shell' {
  export function open(path: string): Promise<unknown>;
}
