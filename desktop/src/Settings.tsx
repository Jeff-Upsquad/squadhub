import { useEffect, useState } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import { disconnectSocket } from './services/socket';

export default function Settings() {
  const { displayName, userEmail, logout } = useAuthStore();
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'connected' | 'disconnected'>('disconnected');

  useEffect(() => {
    isEnabled().then(setAutoLaunch).catch(() => {});

    const handler = (e: Event) => {
      setSocketStatus((e as CustomEvent).detail);
    };
    window.addEventListener('socket-status', handler);
    return () => window.removeEventListener('socket-status', handler);
  }, []);

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

  return (
    <div className="app">
      <div className="card">
        <h1>SquadHub</h1>
        <p>Desktop notifications companion</p>

        <div className={`status-badge ${socketStatus}`}>
          <span className="status-dot" />
          {socketStatus === 'connected' ? 'Connected' : 'Disconnected'}
        </div>

        <div className="user-info">
          Signed in as <strong>{displayName || userEmail}</strong>
        </div>

        <div className="settings-row">
          <span>Launch on startup</span>
          <div
            className={`toggle ${autoLaunch ? 'active' : ''}`}
            onClick={toggleAutoLaunch}
            role="switch"
            aria-checked={autoLaunch}
          />
        </div>

        <div className="spacer" />
        <div className="spacer" />

        <button className="btn btn-primary" onClick={handleMinimize}>
          Minimize to Menu Bar
        </button>

        <div className="spacer" />

        <button className="btn btn-danger" onClick={handleSignOut}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
