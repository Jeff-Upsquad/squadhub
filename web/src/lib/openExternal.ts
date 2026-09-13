// Central helper for opening external URLs.
//
// Why this exists:
// - Inside the Tauri desktop app, `window.open(url, '_blank')` opens *inside*
//   the app's webview. To respect the user's real default browser (Safari,
//   Firefox, …) we must hand the URL to the OS via Tauri's shell/opener.
// - Inside a Chrome "Save as app" dock window there is NO web API that can
//   escape Chrome — the page is still Chrome under the hood. So there the
//   best we can do is a normal new tab (`_blank`). The Tauri desktop app is
//   the path that truly opens the system default browser.
//
// Usage: `openExternalUrl(url)` everywhere instead of raw `window.open`.
// Keep plain `<a href target="_blank">` for accessibility/right-click, but
// attach `onClick={(e) => { e.preventDefault(); openExternalUrl(href); }}` so
// Tauri users get the OS handler.

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    '__TAURI__' in window ||
    '__TAURI_INTERNALS__' in window ||
    typeof w['__TAURI__'] !== 'undefined'
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* ignore */
  }
  // iOS Safari legacy flag.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

async function openViaTauri(url: string): Promise<boolean> {
  try {
    const w = window as unknown as {
      __TAURI__?: {
        opener?: { openUrl?: (u: string) => Promise<void> };
        shell?: { open?: (u: string) => Promise<void> };
        core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      };
    };
    const t = w.__TAURI__;
    // Tauri v2 opener plugin (preferred — opens in the system default browser).
    if (t?.opener?.openUrl) {
      await t.opener.openUrl(url);
      return true;
    }
    // Tauri shell plugin fallback — also delegates to the OS default browser.
    if (t?.shell?.open) {
      await t.shell.open(url);
      return true;
    }
    if (t?.core?.invoke) {
      try {
        await t.core.invoke('plugin:opener|open_url', { url });
        return true;
      } catch {
        /* fall through to plugin-shell command shape */
      }
      try {
        await t.core.invoke('plugin:shell|open', { path: url });
        return true;
      } catch {
        /* fall through */
      }
    }
    // npm plugin packages (bundled only when installed). Dynamic imports so the
    // web build never hard-depends on Tauri packages.
    try {
      const mod = (await import(
        /* @vite-ignore */ '@tauri-apps/plugin-opener'
      ).catch(() => null)) as { openUrl?: (u: string) => Promise<void> } | null;
      if (mod?.openUrl) {
        await mod.openUrl(url);
        return true;
      }
    } catch {
      /* ignore */
    }
    try {
      const mod = (await import(
        /* @vite-ignore */ '@tauri-apps/plugin-shell'
      ).catch(() => null)) as { open?: (u: string) => Promise<unknown> } | null;
      if (mod?.open) {
        await mod.open(url);
        return true;
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* fall through to window.open */
  }
  return false;
}

/** Open an external URL: OS default browser inside Tauri, else a new tab. */
export function openExternalUrl(url: string): void {
  if (!url) return;
  let href = url.trim();
  if (!href) return;
  if (!/^https?:\/\//i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    href = `https://${href}`;
  }
  if (isTauri()) {
    // Fire-and-forget: fall back to _blank if the native bridge fails.
    void openViaTauri(href).then((ok) => {
      if (!ok) window.open(href, '_blank', 'noopener,noreferrer');
    });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
