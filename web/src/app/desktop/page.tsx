'use client';

import { useEffect, useState } from 'react';

type Platform = 'macos' | 'windows' | null;

const MAC_DMG = '/downloads/app/SquadHub-mac.dmg';
const WIN_EXE = '/downloads/app/SquadHub-Setup.exe';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  return null;
}

const INDIGO = '#6366f1';

function downloadButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 32px',
    borderRadius: 12,
    background: active ? INDIGO : 'rgba(99,102,241,0.12)',
    color: active ? '#fff' : INDIGO,
    border: active ? 'none' : '1px solid rgba(99,102,241,0.25)',
    fontSize: 15,
    fontWeight: 600,
    textDecoration: 'none',
    width: 280,
    justifyContent: 'center',
  };
}

export default function DesktopAppPage() {
  const [platform, setPlatform] = useState<Platform>(null);
  useEffect(() => setPlatform(detectPlatform()), []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F0F2F5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1d23',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>SquadHub for Desktop</h1>
        <p style={{ fontSize: 15, color: '#5a6373', marginBottom: 36, lineHeight: 1.6 }}>
          The full SquadHub platform in its own app — opens in a dedicated window, stays in your
          tray/menu bar, and shows desktop notifications. Download for Mac or Windows.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <a href={MAC_DMG} style={downloadButtonStyle(platform !== 'windows')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Download for macOS
          </a>

          <a href={WIN_EXE} style={downloadButtonStyle(platform === 'windows')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5L3 17.75V12.5zM11.5 5.34l9.5-1.34v8h-9.5V5.34zM11.5 12.5H21v7.84l-9.5 1.16V12.5z" />
            </svg>
            Download for Windows
          </a>
        </div>

        <div
          style={{
            marginTop: 44,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 20,
            textAlign: 'center',
          }}
        >
          <Feature icon="🪟" title="Own window" body="Runs as a real app, not a browser tab" />
          <Feature icon="🔔" title="Notifications" body="Desktop alerts while it runs in your tray" />
          <Feature icon="↻" title="Auto-updates" body="Updates itself on launch — no reinstalling" />
        </div>

        {platform === 'macos' && (
          <InstallNote heading="⚠️ macOS install (unsigned build)">
            <p style={{ color: '#374151', marginBottom: 8 }}>
              macOS may say <em>“SquadHub is damaged and can’t be opened”</em> on first launch — this
              is expected for an unsigned app. Open Terminal and run:
            </p>
            <code
              style={{
                display: 'block',
                padding: '10px 12px',
                background: '#1f2937',
                color: '#e5e7eb',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                userSelect: 'all',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              xattr -d com.apple.quarantine /Applications/SquadHub.app
            </code>
            <p style={{ color: '#6b7280', marginTop: 10, fontSize: 12 }}>
              Then open it from Applications. You only need to do this once.
            </p>
          </InstallNote>
        )}

        {platform === 'windows' && (
          <InstallNote heading="ℹ️ Windows install (unsigned build)">
            <p style={{ color: '#374151' }}>
              Windows SmartScreen may warn that the publisher is unknown. Click{' '}
              <strong>More info → Run anyway</strong> to install. The app updates itself after that.
            </p>
          </InstallNote>
        )}
      </div>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#1a1d23' }}>{title}</p>
      <p style={{ fontSize: 12, color: '#6b7280' }}>{body}</p>
    </div>
  );
}

function InstallNote({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 36,
        padding: 20,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        textAlign: 'left',
        fontSize: 13,
        lineHeight: 1.6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 10, color: '#4f46e5' }}>{heading}</p>
      {children}
    </div>
  );
}
