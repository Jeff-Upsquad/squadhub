'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type OS = 'macos' | 'windows';

// Full desktop app (Tauri) — own window, tray, notifications, auto-updates.
const DESKTOP_MAC = '/downloads/app/SquadHub-mac.dmg';
const DESKTOP_WIN = '/downloads/app/SquadHub-Setup.exe';
// Menu-bar companion — lightweight, notifications only. Windows not shipped yet.
const COMPANION_MAC = '/downloads/SquadHub-Desktop-mac.dmg';

// Update manifest the in-app updater polls. We read it only to show the version.
type DesktopManifest = { version?: string; pub_date?: string };

function detectOS(): OS | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  return null;
}

// "Last updated 23 Jun 2026, 7:29 PM IST" — builds are cut from India, so the
// timestamp is shown in IST regardless of the visitor's timezone.
function formatUpdated(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(d);
  return `Last updated ${date}, ${time} IST`;
}

const AppleIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </svg>
);

const WindowsIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-[17px] w-[17px]">
    <path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5L3 17.75V12.5zM11.5 5.34l9.5-1.34v8h-9.5V5.34zM11.5 12.5H21v7.84l-9.5 1.16V12.5z" />
  </svg>
);

// ── Desktop app: own window, tray, auto-updating ─────────────────────────────
const DESKTOP_FEATURES = [
  {
    label: 'Its own window',
    body: 'Runs as a real app, not a browser tab.',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
      </>
    ),
  },
  {
    label: 'Desktop notifications',
    body: 'Alerts while it sits in your tray or menu bar.',
    icon: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  },
  {
    label: 'Auto-updates',
    body: 'Updates itself on launch — no reinstalling.',
    icon: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
      </>
    ),
  },
];

// ── Menu-bar companion: quick capture + notifications, ultra-light ───────────
const COMPANION_FEATURES = [
  {
    label: 'Quick-add tasks',
    body: 'Press ⌘⇧T from any app to capture a task — list, assignee, priority and date — without switching windows.',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
  },
  {
    label: 'Native notifications',
    body: 'Assignments, mentions and messages in your system notification center.',
    icon: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  },
  {
    label: 'Click to open',
    body: 'Each alert jumps straight to the relevant page.',
    icon: (
      <>
        <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        <path d="m13 13 6 6" />
      </>
    ),
  },
  {
    label: 'Featherweight',
    body: 'Runs quietly in your menu bar, under 10 MB.',
    icon: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  },
];

export default function DownloadDesktopPage() {
  const router = useRouter();
  const [os, setOs] = useState<OS>('macos');
  const [manifest, setManifest] = useState<DesktopManifest | null>(null);

  useEffect(() => {
    const detected = detectOS();
    if (detected) setOs(detected);
    // Best-effort version badge for the desktop app; never blocks the page.
    fetch('/downloads/app/latest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: DesktopManifest | null) => m && setManifest(m))
      .catch(() => {});
  }, []);

  return (
    <div className="up-page flex min-h-screen flex-col">
      {/* Header bar */}
      <header className="border-b border-[rgba(0,0,0,0.08)] px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <button
            onClick={() => router.back()}
            className="up-mono inline-flex items-center gap-2 text-[11px] text-[#525252] transition-colors hover:text-[#0A0A0A]"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to SquadHub
          </button>
          <a href="/" className="up-mono text-[11px] text-[#0A0A0A] transition-colors hover:opacity-70">
            Open web app
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          {/* Hero */}
          <div className="mb-10 text-center">
            <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] bg-[#0A0A0A] shadow-[0_16px_38px_-16px_rgba(0,0,0,0.45)]">
              <span className="up-heading text-[26px] font-extrabold tracking-tight text-white">SH</span>
              <span className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border-2 border-[#FAFAFA] bg-[#FFFF99]" />
            </div>
            <h1 className="up-heading text-[32px] font-extrabold tracking-[-0.03em] text-[#0A0A0A] sm:text-[40px]">
              SquadHub on your desktop
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[16px] leading-relaxed text-[#525252] sm:text-[18px]">
              Two ways to bring SquadHub off the browser. Get the full app in its own window, or
              just the menu-bar companion for notifications. Pick one — or run both.
            </p>
          </div>

          {/* ── Desktop App ─────────────────────────────────────────────── */}
          <section className="up-card mb-8 p-7 sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0A0A0A] text-white">
                  <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="13" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                </span>
                <div>
                  <h2 className="up-heading text-[20px] font-bold tracking-[-0.02em] text-[#0A0A0A]">
                    SquadHub Desktop App
                  </h2>
                  <p className="mt-1 max-w-md text-[14px] leading-relaxed text-[#525252]">
                    The whole platform as a native app — its own window, lives in your tray, and
                    keeps itself up to date.
                  </p>
                </div>
              </div>
              <span className="up-mono hidden shrink-0 rounded-full bg-[#FFFF99] px-2.5 py-1 text-[10px] text-[#0A0A0A] sm:inline-block">
                Recommended
              </span>
            </div>

            {/* Download buttons */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={DESKTOP_MAC}
                className={`${os === 'macos' ? 'up-btn' : 'up-btn-secondary'} inline-flex flex-1 items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[14px] font-semibold`}
              >
                {AppleIcon}
                Download for Mac
                <span className="up-mono text-[9px] opacity-60">.dmg</span>
              </a>
              <a
                href={DESKTOP_WIN}
                className={`${os === 'windows' ? 'up-btn' : 'up-btn-secondary'} inline-flex flex-1 items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[14px] font-semibold`}
              >
                {WindowsIcon}
                Download for Windows
                <span className="up-mono text-[9px] opacity-60">.exe</span>
              </a>
            </div>

            {/* Meta row */}
            <div className="up-mono mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[10px] text-[#525252]">
              {manifest?.version && (
                <>
                  <span className="rounded-full bg-[#F5F5F2] px-2.5 py-1 text-[#0A0A0A]">v{manifest.version}</span>
                  <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
                </>
              )}
              <span>Mac &amp; Windows</span>
              <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
              <span>Auto-updating</span>
            </div>
            {formatUpdated(manifest?.pub_date) && (
              <p className="mt-3 text-center text-[12px] text-[#A3A3A3]">{formatUpdated(manifest?.pub_date)}</p>
            )}

            {/* Features */}
            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {DESKTOP_FEATURES.map((f) => (
                <Feature key={f.label} label={f.label} body={f.body}>{f.icon}</Feature>
              ))}
            </div>

            {/* Install instructions — switchable by OS */}
            <div className="mt-7 border-t border-[rgba(0,0,0,0.07)] pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="up-heading text-[15px] font-bold tracking-[-0.01em] text-[#0A0A0A]">
                  First-launch setup
                </h3>
                <div className="inline-flex rounded-full bg-[#F5F5F2] p-0.5">
                  {(['macos', 'windows'] as OS[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setOs(p)}
                      className={`up-mono rounded-full px-3 py-1.5 text-[10px] transition-colors ${
                        os === p ? 'bg-white text-[#0A0A0A] shadow-sm' : 'text-[#A3A3A3] hover:text-[#525252]'
                      }`}
                    >
                      {p === 'macos' ? 'macOS' : 'Windows'}
                    </button>
                  ))}
                </div>
              </div>

              {os === 'macos' ? (
                <InstallNote heading="macOS — unsigned build">
                  <p className="text-[#404040]">
                    On first launch macOS may say <em>“Apple could not verify ‘SquadHub’ is free of
                    malware”</em> (or that the app is <em>“damaged”</em>). That&apos;s expected for an
                    unsigned app — not an actual problem. <strong>Don&apos;t click “Move to Trash.”</strong>
                  </p>
                  <p className="mt-3 text-[#404040]">
                    <strong>Quickest fix</strong> — open <strong>Terminal</strong> and paste:
                  </p>
                  <CodeBlock>xattr -dr com.apple.quarantine /Applications/SquadHub.app</CodeBlock>
                  <p className="mt-3 text-[#404040]">
                    <strong>No Terminal?</strong> Click <strong>Done</strong> on the dialog, then open{' '}
                    <strong>System&nbsp;Settings → Privacy&nbsp;&amp;&nbsp;Security</strong>, scroll down, and
                    click <strong>“Open Anyway”</strong> next to SquadHub.
                  </p>
                  <p className="mt-3 text-[12px] text-[#A3A3A3]">
                    You only need to do this once — updates after that are automatic.
                  </p>
                </InstallNote>
              ) : (
                <InstallNote heading="Windows — unsigned build">
                  <p className="text-[#404040]">
                    Windows SmartScreen may warn that the publisher is unknown. Click{' '}
                    <strong>More info → Run anyway</strong> to install.
                  </p>
                  <p className="mt-3 text-[12px] text-[#A3A3A3]">
                    The app updates itself on launch after that — no need to download again.
                  </p>
                </InstallNote>
              )}
            </div>
          </section>

          {/* ── Menu-bar Companion ──────────────────────────────────────── */}
          <section className="up-card p-7 sm:p-8">
            <div className="mb-6 flex items-start gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F5F5F2] text-[#0A0A0A]">
                <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </span>
              <div>
                <h2 className="up-heading text-[20px] font-bold tracking-[-0.02em] text-[#0A0A0A]">
                  Menu-Bar Companion
                </h2>
                <p className="mt-1 max-w-md text-[14px] leading-relaxed text-[#525252]">
                  Lives in your menu bar so SquadHub is always one keystroke away — fire off a task
                  from any app with a global shortcut, and get real-time desktop alerts without
                  keeping a tab open.
                </p>
              </div>
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {COMPANION_FEATURES.map((f) => (
                <Feature key={f.label} label={f.label} body={f.body}>{f.icon}</Feature>
              ))}
            </div>

            {/* Download buttons */}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a
                href={COMPANION_MAC}
                className="up-btn inline-flex flex-1 items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[14px] font-semibold"
              >
                {AppleIcon}
                Download for Mac
                <span className="up-mono text-[9px] opacity-60">.dmg</span>
              </a>
              <span className="inline-flex flex-1 cursor-not-allowed items-center justify-center gap-2.5 rounded-full border border-dashed border-[rgba(0,0,0,0.14)] bg-[#FAFAFA] px-6 py-3.5 text-[14px] font-semibold text-[#A3A3A3]">
                {WindowsIcon}
                Windows — coming soon
              </span>
            </div>

            {/* Companion meta */}
            <div className="up-mono mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[10px] text-[#525252]">
              <span>macOS</span>
              <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
              <span>~10 MB</span>
              <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
              <span>Quick add + alerts</span>
            </div>

            {/* Install instructions */}
            <div className="mt-7 border-t border-[rgba(0,0,0,0.07)] pt-6">
              <h3 className="up-heading mb-4 text-[15px] font-bold tracking-[-0.01em] text-[#0A0A0A]">
                First-launch setup
              </h3>
              <InstallNote heading="macOS — unsigned build">
                <p className="text-[#404040]">
                  As with the desktop app, macOS may say it <em>“could not verify”</em> the companion (or
                  that it&apos;s <em>“damaged”</em>) on first launch. <strong>Don&apos;t click “Move to
                  Trash.”</strong> Open <strong>Terminal</strong> and paste:
                </p>
                <CodeBlock>xattr -dr com.apple.quarantine &quot;/Applications/SquadHub Companion.app&quot;</CodeBlock>
                <p className="mt-3 text-[#404040]">
                  <strong>No Terminal?</strong> Click <strong>Done</strong>, then open{' '}
                  <strong>System&nbsp;Settings → Privacy&nbsp;&amp;&nbsp;Security</strong> and click{' '}
                  <strong>“Open Anyway”</strong> next to SquadHub Companion.
                </p>
                <p className="mt-3 text-[12px] text-[#A3A3A3]">
                  Then launch it from Applications. Once running, look for the SquadHub icon in your menu bar.
                </p>
              </InstallNote>
            </div>
          </section>

          {/* Bottom CTA */}
          <section className="up-card mt-8 p-6 text-center">
            <div className="up-heading mb-1 text-[14px] font-semibold text-[#0A0A0A]">Prefer to stay in the browser?</div>
            <p className="mb-4 text-[13px] text-[#525252]">
              Everything works on the web too — including push notifications when you install SquadHub as a PWA.
            </p>
            <a href="/" className="up-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold">
              Open web app
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[rgba(0,0,0,0.08)] px-6 py-6">
        <div className="up-mono mx-auto max-w-3xl text-center text-[10px] text-[#A3A3A3]">
          © SquadHub · Powered by UpSquad
        </div>
      </footer>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Sometype+Mono:wght@400;500;600&display=swap');

        .up-page {
          color: #0a0a0a;
          background:
            radial-gradient(ellipse 60% 50% at 15% 10%, rgba(0, 0, 0, 0.05) 0%, transparent 60%),
            radial-gradient(ellipse 50% 50% at 85% 90%, rgba(0, 0, 0, 0.04) 0%, transparent 60%),
            linear-gradient(180deg, #fafafa 0%, #ffffff 100%);
        }
        .up-heading {
          font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
        }
        .up-mono {
          font-family: 'Sometype Mono', 'SFMono-Regular', Consolas, Menlo, monospace;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-weight: 500;
        }
        .up-card {
          background: #ffffff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 8px 24px -16px rgba(0, 0, 0, 0.12);
        }
        .up-card-hover {
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .up-card-hover:hover {
          transform: translateY(-2px);
          border-color: rgba(0, 0, 0, 0.18);
          box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.18);
        }
        .up-btn {
          background: #0a0a0a;
          color: #ffffff;
          border: 1px solid #0a0a0a;
          box-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.5);
          transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
        }
        .up-btn:hover {
          transform: translateY(-2px);
          background: #000000;
          box-shadow: 0 16px 30px -12px rgba(0, 0, 0, 0.55);
        }
        .up-btn:active {
          transform: translateY(0);
          box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.5);
        }
        .up-btn-secondary {
          background: #ffffff;
          color: #0a0a0a;
          border: 1px solid rgba(0, 0, 0, 0.12);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .up-btn-secondary:hover {
          transform: translateY(-2px);
          border-color: rgba(0, 0, 0, 0.28);
          box-shadow: 0 10px 22px -10px rgba(0, 0, 0, 0.16);
        }
        .up-btn-secondary:active {
          transform: translateY(0);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
        }
      `}</style>
    </div>
  );
}

function Feature({ label, body, children }: { label: string; body: string; children: React.ReactNode }) {
  return (
    <div className="up-card up-card-hover flex items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F2]">
        <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      </span>
      <div>
        <div className="up-heading text-[14px] font-semibold text-[#0A0A0A]">{label}</div>
        <div className="mt-0.5 text-[13px] leading-snug text-[#525252]">{body}</div>
      </div>
    </div>
  );
}

function InstallNote({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-[#FAFAFA] p-5 text-[13px] leading-relaxed">
      <p className="up-mono mb-2.5 text-[10px] text-[#0A0A0A]">{heading}</p>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mt-3 block overflow-x-auto whitespace-nowrap rounded-lg px-3 py-2.5 text-[12px]"
      style={{
        background: '#1f2937',
        color: '#e5e7eb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        userSelect: 'all',
      }}
    >
      {children}
    </code>
  );
}
