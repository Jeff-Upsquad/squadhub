'use client';

import { useEffect, useState } from 'react';

type AppConfig = {
  minVersion: string;
  downloadUrl: string;
};

export default function PartnerAppLanding() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/partner-app/app-config')
      .then((r) => r.json())
      .then((data: AppConfig) => setConfig(data))
      .catch(() => setError('Could not load app details. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  const hasDownload = !!config?.downloadUrl;

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-[#0F172B]">
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-12">
        {/* Brand */}
        <div className="flex items-start gap-2 text-sm font-medium tracking-tight text-[#62748E]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#0F172B] text-[10px] font-bold text-white">
            SH
          </span>
          <div className="flex flex-col leading-tight">
            <span>SquadHub</span>
            <span className="text-[11px]">Powered by UpSquad</span>
          </div>
        </div>

        {/* Hero */}
        <div className="mt-12 flex-1">
          <div
            aria-hidden
            className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-[#0F172B] text-white shadow-sm ring-1 ring-inset ring-white/10"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
              <path
                d="M5 12.5L9.5 17L19 7.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="font-[family-name:var(--font-display)] text-[40px] leading-[1.05] font-semibold tracking-tight text-[#0F172B]">
            SquadHub Partner
          </h1>
          <p className="mt-4 text-[17px] leading-snug text-[#62748E]">
            Your tasks and inbox, in your pocket. Stay on top of what's due today, tomorrow, and overdue — nothing more.
          </p>

          {/* Download card */}
          <div className="mt-10 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_0_rgba(15,23,43,0.02),0_10px_30px_-20px_rgba(15,23,43,0.15)]">
            {loading ? (
              <div className="h-[52px] w-full animate-pulse rounded-xl bg-[#F1F5F9]" />
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            ) : hasDownload ? (
              <a
                href={config!.downloadUrl}
                download
                className="group flex w-full items-center justify-between rounded-xl bg-[#0F172B] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-[#1D293D] active:scale-[0.99]"
              >
                <span className="flex items-center gap-3">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <path
                      d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Download APK
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/80">
                  v{config!.minVersion}
                </span>
              </a>
            ) : (
              <div className="rounded-xl border border-dashed border-[#CAD5E2] bg-[#F8FAFC] p-4 text-center text-sm text-[#62748E]">
                The APK isn't published yet. Check back shortly.
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-[#90A1B9]">
              Android 8.0 or later · ~25 MB
            </p>
          </div>

          {/* Install steps */}
          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#62748E]">
              How to install
            </h2>
            <ol className="mt-4 space-y-4">
              {[
                {
                  title: 'Download the APK',
                  body: 'Tap the button above on your Android phone.',
                },
                {
                  title: 'Allow install from this source',
                  body: 'Android will ask for permission the first time — tap Settings → enable "Allow from this source".',
                },
                {
                  title: 'Open and sign in',
                  body: 'Use your SquadHub partner email. The app auto-updates after that.',
                },
              ].map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] bg-white text-[11px] font-semibold text-[#0F172B]">
                    {i + 1}
                  </span>
                  <div className="text-[14px] leading-snug">
                    <div className="font-medium text-[#0F172B]">{step.title}</div>
                    <div className="mt-0.5 text-[#62748E]">{step.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Features */}
          <section className="mt-12 grid grid-cols-2 gap-3">
            {[
              { label: 'Today & tomorrow', body: 'See only what needs you next.' },
              { label: 'Overdue surfacing', body: "Nothing you missed slips away." },
              { label: 'Inbox', body: 'Mentions, assignments, status changes.' },
              { label: 'Built for speed', body: '60fps, offline-aware, low battery.' },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-xl border border-[#E2E8F0] bg-white p-3.5"
              >
                <div className="text-[13px] font-medium text-[#0F172B]">{f.label}</div>
                <div className="mt-1 text-[12px] leading-snug text-[#62748E]">{f.body}</div>
              </div>
            ))}
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-16 flex items-center justify-between border-t border-[#E2E8F0] pt-6 text-[11px] text-[#90A1B9]">
          <span>© SquadHub</span>
          <a href="/login" className="transition hover:text-[#0F172B]">
            Open web app →
          </a>
        </footer>
      </main>
    </div>
  );
}
