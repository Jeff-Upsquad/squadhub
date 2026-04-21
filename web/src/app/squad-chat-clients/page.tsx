'use client';

import { useEffect, useState } from 'react';

type AppConfig = {
  variant: 'clients' | 'team';
  min_version: string;
  download_url: string | null;
};

export default function SquadChatClientsLanding() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/chat/app/config?variant=clients')
      .then((r) => r.json())
      .then((data: AppConfig) => setConfig(data))
      .catch(() => setError('Could not load app details. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  const hasDownload = !!config?.download_url;

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-[#0F172B]">
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-12">
        <div className="flex items-center gap-2 text-sm font-medium tracking-tight text-[#62748E]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#0F172B] text-[10px] font-bold text-white">
            SH
          </span>
          SquadHub
        </div>

        <div className="mt-12 flex-1">
          <div
            aria-hidden
            className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-[#0F172B] text-white shadow-sm ring-1 ring-inset ring-white/10"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
              <path
                d="M4.5 5h15c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H9l-4 4V6.5C5 5.7 5.7 5 6.5 5z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="font-[family-name:var(--font-display)] text-[40px] leading-[1.05] font-semibold tracking-tight text-[#0F172B]">
            Squad Chat
          </h1>
          <p className="mt-4 text-[17px] leading-snug text-[#62748E]">
            Group chat with your SquadHub team. Voice notes, photos, videos, and documents in one fast, familiar app.
          </p>

          <div className="mt-10 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_0_rgba(15,23,43,0.02),0_10px_30px_-20px_rgba(15,23,43,0.15)]">
            {loading ? (
              <div className="h-[52px] w-full animate-pulse rounded-xl bg-[#F1F5F9]" />
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            ) : hasDownload ? (
              <a
                href={config!.download_url!}
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
                  v{config!.min_version}
                </span>
              </a>
            ) : (
              <div className="rounded-xl border border-dashed border-[#CAD5E2] bg-[#F8FAFC] p-4 text-center text-sm text-[#62748E]">
                The APK isn&apos;t published yet. Check back shortly.
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-[#90A1B9]">
              Android 8.0 or later
            </p>
          </div>

          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#62748E]">
              How to install
            </h2>
            <ol className="mt-4 space-y-4">
              {[
                { title: 'Download the APK', body: 'Tap the button above on your Android phone.' },
                { title: 'Allow install from this source', body: 'Android will ask for permission the first time — tap Settings → enable "Allow from this source".' },
                { title: 'Open and sign in', body: 'Use your SquadHub email and password. Your groups will appear automatically.' },
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

          <section className="mt-12 grid grid-cols-2 gap-3">
            {[
              { label: 'Voice notes', body: 'Hold to record, slide to cancel.' },
              { label: 'Photo & video', body: 'Share from your gallery instantly.' },
              { label: 'Documents', body: 'Send any file up to 100 MB.' },
              { label: 'Delivered + read', body: 'Know when teammates have seen.' },
              { label: '@mentions', body: 'Grab someone\u2019s attention.' },
              { label: 'Reply & quote', body: 'Keep threads easy to follow.' },
            ].map((f) => (
              <div key={f.label} className="rounded-xl border border-[#E2E8F0] bg-white p-3.5">
                <div className="text-[13px] font-medium text-[#0F172B]">{f.label}</div>
                <div className="mt-1 text-[12px] leading-snug text-[#62748E]">{f.body}</div>
              </div>
            ))}
          </section>
        </div>

        <footer className="mt-16 flex items-center justify-between border-t border-[#E2E8F0] pt-6 text-[11px] text-[#90A1B9]">
          <span>© SquadHub · Squad Chat</span>
          <a href="/login" className="transition hover:text-[#0F172B]">Open web app →</a>
        </footer>
      </main>
    </div>
  );
}
