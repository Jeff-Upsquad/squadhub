export function PanelIcon({ name }: { name: 'timer' | 'add' | 'tray' | 'collapse' | 'close' | 'pause' | 'play' | 'stop' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'timer' && <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M10 2h4" /></>}
      {name === 'add' && <path d="M12 5v14M5 12h14" />}
      {name === 'tray' && <><path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></>}
      {name === 'collapse' && <path d="m18 15-6-6-6 6" />}
      {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
      {name === 'pause' && <><path d="M8 6v12M16 6v12" strokeWidth="4" /></>}
      {name === 'play' && <path d="m9 5 10 7-10 7z" fill="currentColor" stroke="none" />}
      {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    </svg>
  );
}
