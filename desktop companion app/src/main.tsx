import { StrictMode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from './stores/authStore';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import QuickAdd from './QuickAdd';
import Notch from './Notch';
import './styles.css';

// All three windows load this same SPA; branch on the window label so each
// renders its own surface: the spotlight quick-add, the notch timer, or the
// main Settings/Login app.
void listen('companion:auth-changed', () => { void useAuthStore.getState().hydrate(); });

const label = getCurrentWindow().label;
const isQuickAdd = label === 'quickadd';
const isNotch = label === 'notch';

// The quickadd + notch windows are transparent so their rounded panels / menus
// can spill past the visible card without clipping; scope the see-through
// background to those windows only.
if (isQuickAdd) document.body.classList.add('qa-window');
if (isNotch) document.body.classList.add('notch-window');

function Root() {
  if (isQuickAdd) return <QuickAdd />;
  if (isNotch) return <Notch />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Root /></StrictMode>,
);
