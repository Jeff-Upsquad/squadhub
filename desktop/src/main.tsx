import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import QuickAdd from './QuickAdd';
import './styles.css';

// Both windows load this same SPA; branch on the window label so the hidden
// "quickadd" window renders the spotlight capture UI instead of the main app.
const isQuickAdd = getCurrentWindow().label === 'quickadd';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isQuickAdd ? <QuickAdd /> : <App />}</StrictMode>,
);
