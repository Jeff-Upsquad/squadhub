import { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { connectSocket, disconnectSocket } from './services/socket';
import Login from './Login';
import Settings from './Settings';

export default function App() {
  const { isAuthenticated, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Desktop updates are surfaced + installed from the Settings window
  // (see useUpdater): it auto-checks on mount and lets the user install on
  // demand, instead of a silent download/relaunch on launch.

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
