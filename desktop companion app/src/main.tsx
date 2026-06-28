import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import QuickAdd from './QuickAdd';
import './styles.css';

// Both windows load this same SPA; branch on the window label so the hidden
// "quickadd" window renders the spotlight capture UI instead of the main app.
const isQuickAdd = getCurrentWindow().label === 'quickadd';

// The quickadd window is transparent so its menus can spill past the visible
// card without clipping; scope the see-through background to that window only.
if (isQuickAdd) document.body.classList.add('qa-window');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isQuickAdd ? <QuickAdd /> : <App />}</StrictMode>,
);
