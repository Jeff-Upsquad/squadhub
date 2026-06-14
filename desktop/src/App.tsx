import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAuthStore } from './stores/authStore';
import { connectSocket, disconnectSocket } from './services/socket';
import Login from './Login';
import Settings from './Settings';

export default function App() {
  const { isAuthenticated, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Check for desktop updates on launch; if a newer signed build is published to
  // the updater endpoint, download + install + relaunch. Runs only in the main
  // window (the quickadd window renders QuickAdd, not App).
  useEffect(() => {
    (async () => {
      try {
        const update = await check();
        if (update) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } catch (e) {
        console.error('Update check failed:', e);
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
