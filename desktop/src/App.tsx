import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Window } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import { connectSocket, disconnectSocket } from './services/socket';
import Login from './Login';
import Settings from './Settings';

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6h while running

export default function App() {
  const { isAuthenticated, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Auto-update: check on launch and periodically while running. When a newer
  // signed build is published, install it and relaunch automatically — unless
  // the quick-add spotlight is open, so we never nuke an in-progress capture
  // (we'll catch it on the next cycle / launch). Manual check + install also
  // remains available in Settings (see useUpdater).
  useEffect(() => {
    let cancelled = false;
    const tryAutoUpdate = async () => {
      try {
        const update = await check();
        if (!update || cancelled) return;
        const qa = await Window.getByLabel('quickadd');
        if (qa && (await qa.isVisible())) return; // user mid-capture; defer
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        console.error('Auto-update failed:', e);
      }
    };
    void tryAutoUpdate();
    const id = setInterval(() => void tryAutoUpdate(), UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }

    connectSocket();

    return () => {
      disconnectSocket();
    };
  }, [isAuthenticated]);

  if (!hydrated) {
    return (
      <div className="app">
        <div className="logo">⚡</div>
      </div>
    );
  }

  return isAuthenticated ? <Settings /> : <Login />;
}
