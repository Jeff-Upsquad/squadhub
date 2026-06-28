import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Window } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import { connectSocket, disconnectSocket } from './services/socket';
import Login from './Login';
import Settings from './Settings';

export default function App() {
  const { isAuthenticated, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Auto-update on launch: if a newer signed build is published, install it and
  // relaunch — unless the quick-add spotlight is open, so we never interrupt an
  // in-progress capture. A manual "Check for updates" also lives in Settings
  // (see useUpdater); there's no periodic background check.
  useEffect(() => {
    (async () => {
      try {
        const update = await check();
        if (!update) return;
        const qa = await Window.getByLabel('quickadd');
        if (qa && (await qa.isVisible())) return; // user mid-capture; defer
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        console.error('Auto-update failed:', e);
      }
    })();
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
