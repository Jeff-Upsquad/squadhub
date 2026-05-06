import { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { connectSocket, disconnectSocket } from './services/socket';
import { ensurePermission, setupNotificationClickHandler } from './services/notifications';
import Login from './Login';
import Settings from './Settings';

export default function App() {
  const { isAuthenticated, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
    setupNotificationClickHandler();
  }, [hydrate]);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }

    ensurePermission();
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
