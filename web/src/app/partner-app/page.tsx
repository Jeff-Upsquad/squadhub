'use client';

import { useEffect, useState } from 'react';

// Release manifest served by GET /partner-app/version — the same source of
// truth the in-app updater polls and that `tools/release.sh` (GO LIVE) updates.
type Manifest = {
  version_code: number;
  version_name: string;
  apk_url: string;
  release_notes?: string;
};

const FEATURES = [
  {
    label: 'Today & tomorrow',
    body: 'See only what needs you next.',
    icon: (
      <>
        <path d="M8 2v4M16 2v4M3 10h18" />
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="m9 16 2 2 4-4" />
      </>
    ),
  },
  {
    label: 'Overdue surfacing',
    body: 'Nothing you missed slips away.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    label: 'Inbox',
    body: 'Mentions, assignments, status changes.',
    icon: (
      <>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      </>
    ),
  },
  {
    label: 'Built for speed',
    body: '60fps, offline-aware, low battery.',
    icon: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  },
];

const STEPS = [
  'Tap Download APK above on your Android phone.',
  'If prompted, allow installation from this source in Settings.',
  'Open SquadHub Partner and sign in with your partner email. It auto-updates after that.',
];

export default function PartnerAppLanding() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/partner-app/version')
      .then((r) => r.json())
      .then((res: { success: boolean; data: Manifest | null }) => setManifest(res.data))
      .catch(() => setError('Could not load app details. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  // version_code starts at 1 (the bootstrap/fallback). A real release bumps it,
  // so only offer the download once an actual version has been published.
  const hasDownload = !!manifest && manifest.version_code > 1 && !!manifest.apk_url;

  return (
    <div className="up-page flex min-h-screen flex-col">
      {/* Header bar */}
      <header className="border-b border-[rgba(0,0,0,0.08)] px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <a
            href="/"
            className="up-mono inline-flex items-center gap-2 text-[11px] text-[#525252] transition-colors hover:text-[#0A0A0A]"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to website
          </a>
          <a
            href="/login"
            className="up-mono text-[11px] text-[#0A0A0A] transition-colors hover:opacity-70"
          >
            Open web app
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-2xl">
          {/* Hero */}
          <div className="mb-10 text-center">
            <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] bg-[#0A0A0A] shadow-[0_16px_38px_-16px_rgba(0,0,0,0.45)]">
              <span className="up-heading text-[26px] font-extrabold tracking-tight text-white">SH</span>
              {/* Lone accent */}
              <span className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border-2 border-[#FAFAFA] bg-[#FFFF99]" />
            </div>
            <h1 className="up-heading text-[32px] font-extrabold tracking-[-0.03em] text-[#0A0A0A] sm:text-[40px]">
              SquadHub Partner
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[16px] leading-relaxed text-[#525252] sm:text-[18px]">
              Your tasks and inbox, in your pocket. Stay on top of what&apos;s due today, tomorrow, and overdue — nothing more.
            </p>
          </div>

          {/* Download card */}
          <div className="up-card mb-8 p-8 text-center">
            {loading ? (
              <div className="mx-auto h-[50px] w-56 animate-pulse rounded-full bg-[#F5F5F2]" />
            ) : error ? (
              <div className="rounded-xl border border-[rgba(0,0,0,0.08)] bg-[#F5F5F2] p-4 text-sm font-medium text-[#525252]">
                {error}
              </div>
            ) : hasDownload ? (
              <>
                <div className="flex justify-center">
                  <a
                    href={manifest!.apk_url}
                    download
                    className="up-btn inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[14px] font-semibold"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path
                        d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download APK
                  </a>
                </div>

                {/* Meta row */}
                <div className="up-mono mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[10px] text-[#525252]">
                  <span className="rounded-full bg-[#FFFF99] px-2.5 py-1 text-[#0A0A0A]">v{manifest!.version_name}</span>
                  <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
                  <span>Android 8.0+</span>
                  <span className="h-1 w-1 rounded-full bg-[#D4D4D4]" />
                  <span>~25 MB</span>
                </div>

                <p className="mt-4 text-[12px] leading-relaxed text-[#A3A3A3]">
                  Signed build — the app keeps itself up to date after install.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[rgba(0,0,0,0.14)] bg-[#FAFAFA] p-4 text-center text-sm text-[#525252]">
                The APK isn&apos;t published yet. Check back shortly.
              </div>
            )}
          </div>

          {/* What's new */}
          {hasDownload && manifest!.release_notes && (
            <section className="mb-8">
              <h2 className="up-heading mb-4 text-[18px] font-bold tracking-[-0.02em] text-[#0A0A0A]">What&apos;s new</h2>
              <ul className="space-y-2.5">
                {manifest!.release_notes
                  .split('\n')
                  .map((l) => l.replace(/^[•\-\s]+/, '').trim())
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-snug text-[#404040]">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0A0A0A]" />
                      <span>{line}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {/* What you get */}
          <section>
            <h2 className="up-heading mb-5 text-[18px] font-bold tracking-[-0.02em] text-[#0A0A0A]">What you get</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.label} className="up-card up-card-hover flex items-start gap-3.5 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F2]">
                    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {f.icon}
                    </svg>
                  </span>
                  <div>
                    <div className="up-heading text-[14px] font-semibold text-[#0A0A0A]">{f.label}</div>
                    <div className="mt-0.5 text-[13px] leading-snug text-[#525252]">{f.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* How to install */}
          <section className="up-card mt-8 p-6">
            <h2 className="up-heading mb-4 text-[16px] font-bold tracking-[-0.02em] text-[#0A0A0A]">How to install</h2>
            <ol className="space-y-3">
              {STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="up-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0A0A0A] text-[11px] text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-[14px] leading-relaxed text-[#404040]">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Bottom CTA */}
          <section className="up-card mt-8 p-6 text-center">
            <div className="up-heading mb-1 text-[14px] font-semibold text-[#0A0A0A]">Already a partner?</div>
            <p className="mb-4 text-[13px] text-[#525252]">
              Sign in with your SquadHub partner email — on the app or the web.
            </p>
            <a href="/login" className="up-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold">
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
        <div className="up-mono mx-auto max-w-2xl text-center text-[10px] text-[#A3A3A3]">
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
