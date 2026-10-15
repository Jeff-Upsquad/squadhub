import { useEffect, useState } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { useAuthStore } from './stores/authStore';
import { disconnectSocket } from './services/socket';
import { useUpdater } from './hooks/useUpdater';

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+T';

// Build a Tauri accelerator string from a keydown event. Requires at least one
// modifier plus a non-modifier key; returns null otherwise (keep listening).
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push('CommandOrControl');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const code = e.code;
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (code === 'Space') key = 'Space';
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
  else if (/^F[0-9]{1,2}$/.test(code)) key = code;
  if (!key || mods.length === 0) return null;
  return [...mods, key].join('+');
}

function prettyShortcut(accel: string): string {
  return accel
    .split('+')
    .map((p) => {
      switch (p) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
        case 'Command':
        case 'Cmd':
        case 'Super':
          return '⌘';
        case 'Control':
        case 'Ctrl':
          return '⌃';
        case 'Alt':
        case 'Option':
          return '⌥';
        case 'Shift':
          return '⇧';
        default:
          return p;
      }
    })
    .join('');
}

export default function Settings() {
  const { displayName, userEmail, logout } = useAuthStore();
  const updater = useUpdater();
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    isEnabled().then(setAutoLaunch).catch(() => {});

    const handler = (e: Event) => {
      setSocketStatus((e as CustomEvent).detail);
    };
    window.addEventListener('socket-status', handler);
    return () => window.removeEventListener('socket-status', handler);
  }, []);

  useEffect(() => {
    load('settings.json')
      .then((s) => s.get<string>('quick_add_shortcut'))
      .then((saved) => { if (saved) setShortcut(saved); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') { setRecording(false); return; }
      const accel = toAccelerator(e);
      if (!accel) return; // wait for a valid modifier + key combination
      try {
        await invoke('set_quick_add_shortcut', { accelerator: accel });
        setShortcut(accel);
      } catch (err) {
        console.error('Failed to set shortcut:', err);
      }
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const toggleAutoLaunch = async () => {
    try {
      if (autoLaunch) {
        await disable();
        setAutoLaunch(false);
      } else {
        await enable();
        setAutoLaunch(true);
      }
    } catch (err) {
      console.error('Auto-launch toggle failed:', err);
    }
  };

  const handleSignOut = async () => {
    disconnectSocket();
    await logout();
  };

  const handleMinimize = () => {
    getCurrentWindow().hide();
  };

  const name = displayName || userEmail || 'SquadHub';
  const avatarInitials = (() => {
    const src = (displayName && displayName.trim()) || (userEmail && userEmail.trim()) || 'SH';
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  })();

  return (
    <div className="app cmp-app">
      <div className="cmp-card">
        <div className="cmp-header">
          <div className="cmp-brand">
            <span className="cmp-logo" aria-hidden />
            <div>
              <div className="cmp-brand-name">SquadHub</div>
              <div className="cmp-brand-sub">Desktop companion</div>
            </div>
          </div>
          <div className={`cmp-badge ${socketStatus}`}>
            <span className="cmp-badge-dot" />
            {socketStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="cmp-user">
          <span className="cmp-avatar">{avatarInitials}</span>
          <div className="cmp-user-text">
            <div className="cmp-user-name">{name}</div>
            {userEmail && <div className="cmp-user-sub">{userEmail}</div>}
          </div>
        </div>

        <div className="cmp-group">
          <div className="cmp-row cmp-row-stack">
            <div className="cmp-row-head">
              <span className="cmp-label">Quick add shortcut</span>
              <span className="cmp-hint">Click to change</span>
            </div>
            <button
              type="button"
              className={`cmp-shortcut ${recording ? 'recording' : ''}`}
              onClick={() => setRecording((r) => !r)}
              title="Click, then press your desired key combination (Esc to cancel)"
            >
              {recording
                ? 'Press keys…'
                : prettyShortcut(shortcut)
                    .split('')
                    .map((ch, i) => (
                      <span key={i} className="cmp-key">{ch}</span>
                    ))}
            </button>
          </div>

          <div className="cmp-row">
            <span className="cmp-label">Launch on startup</span>
            <div
              className={`toggle ${autoLaunch ? 'active' : ''}`}
              onClick={toggleAutoLaunch}
              role="switch"
              aria-checked={autoLaunch}
            />
          </div>

          <div className="cmp-row">
            <span className="cmp-label">
              Version{updater.currentVersion ? ` ${updater.currentVersion}` : ''}
            </span>
            {updater.status === 'available' || updater.status === 'downloading' ? (
              <span className="update-tag">Update available</span>
            ) : (
              <button
                type="button"
                className="cmp-mini-btn"
                onClick={() => updater.check(false)}
                disabled={updater.status === 'checking'}
              >
                {updater.status === 'checking'
                  ? 'Checking…'
                  : updater.status === 'uptodate'
                    ? 'Up to date'
                    : 'Check'}
              </button>
            )}
          </div>
        </div>

        {updater.status === 'available' && (
          <div className="update-box">
            <div className="update-box-head">
              <span>A new version is ready</span>
              <span className="update-ver">v{updater.newVersion}</span>
            </div>
            {updater.notes && <p className="update-notes">{updater.notes}</p>}
            <button className="btn btn-primary" onClick={() => updater.install()}>
              Install &amp; restart
            </button>
          </div>
        )}

        {updater.status === 'downloading' && (
          <div className="update-box">
            <div className="update-progress">
              <div
                className="update-progress-bar"
                style={{ width: `${updater.progress ?? 100}%` }}
              />
            </div>
            <p className="update-notes">
              {updater.progress === null || updater.progress >= 100
                ? 'Installing… the app will restart.'
                : `Downloading… ${updater.progress}%`}
            </p>
          </div>
        )}

        {updater.status === 'error' && (
          <div className="update-box update-box-error">
            <p className="update-notes">{updater.error || 'Update failed. Please try again.'}</p>
            <button className="btn btn-primary" onClick={() => updater.check(false)}>
              Try again
            </button>
          </div>
        )}

        <div className="cmp-footer">
          <button className="cmp-footer-btn" onClick={handleMinimize}>
            Minimize to menu bar
          </button>
          <button className="cmp-footer-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
