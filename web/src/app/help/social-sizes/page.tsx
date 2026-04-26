'use client';

import Link from 'next/link';

type Row = { asset: string; size: string; note?: string };

type Section = {
  title: string;
  blurb?: string;
  groups: { heading?: string; rows: Row[] }[];
  note?: string;
};

const RATIOS: Row[] = [
  { asset: '1:1 (Square)', size: '1080 × 1080', note: 'Universal feed posts' },
  { asset: '4:5 (Portrait)', size: '1080 × 1350', note: 'Instagram & LinkedIn feed (best reach)' },
  { asset: '9:16 (Vertical)', size: '1080 × 1920', note: 'Stories, Reels, Shorts, TikTok' },
];

const SECTIONS: Section[] = [
  {
    title: 'Instagram',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '320 × 320', note: 'displays as circle, 110 × 110' },
          { asset: 'Square post', size: '1080 × 1080' },
          { asset: 'Portrait post (recommended)', size: '1080 × 1350' },
          { asset: 'Landscape post', size: '1080 × 566' },
          { asset: 'Stories / Reels', size: '1080 × 1920' },
          { asset: 'Carousel (all slides same)', size: '1080 × 1350' },
          { asset: 'Tall grid display', size: '1080 × 1440 (3:4)' },
        ],
      },
    ],
  },
  {
    title: 'Facebook',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '320 × 320 minimum' },
          { asset: 'Cover photo', size: '851 × 315 desktop / 640 × 360 mobile-safe' },
          { asset: 'Feed post (square)', size: '1080 × 1080' },
          { asset: 'Feed post (landscape)', size: '1200 × 630' },
          { asset: 'Link preview', size: '1200 × 630 (1.91:1)' },
          { asset: 'Stories', size: '1080 × 1920' },
          { asset: 'Event cover', size: '1920 × 1005' },
          { asset: 'Group cover', size: '1640 × 856' },
        ],
      },
    ],
    note: 'Keep text/logos away from bottom-left of cover — profile pic overlaps there.',
  },
  {
    title: 'LinkedIn',
    groups: [
      {
        heading: 'Personal Profile',
        rows: [
          { asset: 'Profile picture', size: '400 × 400' },
          { asset: 'Background / banner', size: '1584 × 396 (4:1)' },
        ],
      },
      {
        heading: 'Company Page',
        rows: [
          { asset: 'Logo', size: '300 × 300' },
          { asset: 'Cover image', size: '1128 × 191' },
          { asset: 'Life tab main', size: '1128 × 376' },
        ],
      },
      {
        heading: 'Posts',
        rows: [
          { asset: 'Square feed post', size: '1200 × 1200' },
          { asset: 'Link preview / single image', size: '1200 × 627' },
          { asset: 'Portrait post', size: '1080 × 1350' },
          { asset: 'Article cover', size: '1200 × 644' },
          { asset: 'Document/PDF post', size: '1080 × 1080 (or 1080 × 1350)' },
        ],
      },
    ],
  },
  {
    title: 'Meta Ads (Facebook + Instagram)',
    groups: [
      {
        rows: [
          { asset: 'Feed — Square (most common)', size: '1080 × 1080' },
          { asset: 'Feed — Landscape', size: '1200 × 628' },
          { asset: 'Feed — Vertical', size: '1080 × 1350' },
          { asset: 'Stories / Reels Ads', size: '1080 × 1920' },
          { asset: 'Carousel Ads (each card)', size: '1080 × 1080' },
          { asset: 'Right column (FB desktop)', size: '1200 × 1200' },
          { asset: 'Marketplace', size: '1080 × 1080' },
          { asset: 'Audience Network', size: '1080 × 1080 or 1080 × 1920' },
        ],
      },
    ],
    note: 'Safe zone for Stories/Reels ads: keep text & logos within the center 1080 × 1420. Top 250px and bottom 250px get covered by UI.',
  },
  {
    title: 'X (Twitter)',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '400 × 400' },
          { asset: 'Header', size: '1500 × 500' },
          { asset: 'In-stream image', size: '1600 × 900 (16:9) or 1080 × 1080' },
          { asset: 'Card image', size: '1200 × 628' },
        ],
      },
    ],
  },
  {
    title: 'YouTube',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '800 × 800' },
          { asset: 'Channel banner', size: '2560 × 1440 (safe area: 1546 × 423)' },
          { asset: 'Thumbnail', size: '1280 × 720' },
          { asset: 'Shorts', size: '1080 × 1920' },
          { asset: 'End screen', size: '1280 × 720' },
        ],
      },
    ],
    note: 'Banners crop differently across TV / desktop / mobile — keep logo + text inside the 1546 × 423 safe zone.',
  },
  {
    title: 'Pinterest',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '165 × 165' },
          { asset: 'Standard pin (recommended)', size: '1000 × 1500 (2:3)' },
          { asset: 'Square pin', size: '1000 × 1000' },
          { asset: 'Long pin', size: '1000 × 2100' },
          { asset: 'Story pin', size: '1080 × 1920' },
        ],
      },
    ],
  },
  {
    title: 'TikTok',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '200 × 200' },
          { asset: 'Video', size: '1080 × 1920 (9:16)' },
          { asset: 'In-feed ad', size: '1080 × 1920' },
        ],
      },
    ],
    note: 'Keep captions/hooks center 1080 × 1300 — TikTok UI covers the top and bottom.',
  },
  {
    title: 'Threads',
    groups: [
      {
        rows: [
          { asset: 'Profile picture', size: '320 × 320' },
          { asset: 'Square post', size: '1080 × 1080' },
          { asset: 'Portrait post', size: '1080 × 1350' },
          { asset: 'Link preview (Open Graph)', size: '1200 × 600' },
        ],
      },
    ],
  },
];

const UNIVERSAL: Row[] = [
  { asset: 'Square post (FB, IG, LinkedIn, X)', size: '1080 × 1080' },
  { asset: 'Stories / Reels / Shorts / TikTok (one file)', size: '1080 × 1920' },
  { asset: 'Link preview (FB, LinkedIn, X)', size: '1200 × 630' },
];

export default function SocialSizesHelpPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#0F172B]">
      <header className="border-b border-[#E2E8F0] bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#90A1B9]">SquadHub help</div>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight">Social media design sizes</h1>
            <p className="mt-1 text-sm text-[#62748E]">Reference for designers — all sizes in pixels (W × H).</p>
          </div>
          <Link
            href="/app"
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm text-[#62748E] hover:bg-[#F8FAFC]"
          >
            ← Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#62748E]">
            The 3 ratios to memorize
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {RATIOS.map((r) => (
              <div key={r.asset} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
                <div className="text-base font-semibold">{r.asset}</div>
                <div className="mt-1 font-mono text-sm text-[#0F172B]">{r.size}</div>
                {r.note && <div className="mt-2 text-[12px] text-[#62748E]">{r.note}</div>}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-[#62748E]">
            <span className="font-medium text-[#0F172B]">Pro tip:</span> design your master at 1080 × 1350 (4:5).
            You can crop to 1:1 easily. Vertical (4:5) gets ~78% more screen space than square on mobile.
          </p>
        </section>

        {SECTIONS.map((sec) => (
          <section key={sec.title} className="mb-10">
            <h2 className="mb-3 text-base font-semibold">{sec.title}</h2>
            <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
              {sec.groups.map((g, gi) => (
                <div key={gi}>
                  {g.heading && (
                    <div className="border-b border-[#F1F5F9] bg-[#FAFAF8] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#62748E]">
                      {g.heading}
                    </div>
                  )}
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {g.rows.map((r, ri) => (
                        <tr
                          key={ri}
                          className={ri < g.rows.length - 1 || gi < sec.groups.length - 1 ? 'border-b border-[#F1F5F9]' : ''}
                        >
                          <td className="px-4 py-2.5 text-[#0F172B]">
                            {r.asset}
                            {r.note && <span className="ml-2 text-[12px] text-[#90A1B9]">({r.note})</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[#0F172B]">{r.size}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {sec.note && (
              <p className="mt-2 text-[13px] text-[#62748E]">
                <span className="font-medium text-[#0F172B]">Note:</span> {sec.note}
              </p>
            )}
          </section>
        ))}

        <section className="mb-10">
          <h2 className="mb-3 text-base font-semibold">Universal sizes that work everywhere</h2>
          <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {UNIVERSAL.map((r, ri) => (
                  <tr key={ri} className={ri < UNIVERSAL.length - 1 ? 'border-b border-[#F1F5F9]' : ''}>
                    <td className="px-4 py-2.5">{r.asset}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-base font-semibold">File format cheats</h2>
          <ul className="space-y-1.5 text-[13.5px] text-[#0F172B]">
            <li>• <span className="font-medium">Photos:</span> JPG (smaller files, good quality)</li>
            <li>• <span className="font-medium">Logos / text-heavy graphics:</span> PNG (sharper edges)</li>
            <li>• <span className="font-medium">Animated:</span> GIF or MP4</li>
            <li>• <span className="font-medium">Always export at 2× for retina</span> when possible</li>
            <li>• <span className="font-medium">Width = 1080px minimum</span> for sharp display on modern phones</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-base font-semibold">Common pitfalls</h2>
          <ol className="space-y-2 text-[13.5px] text-[#0F172B]">
            <li>1. Never put critical text in the outer 10% of a Story/Reel — it gets cropped or covered by UI.</li>
            <li>2. LinkedIn personal banner crops differently on mobile vs desktop — preview both.</li>
            <li>3. Carousel slides must all be the same dimensions.</li>
            <li>4. Don&apos;t upload below 1080px wide — IG/FB will compress and blur.</li>
            <li>5. Facebook event cover is technically 1920 × 1005, but desktop crops it heavily — design for the mobile crop.</li>
          </ol>
        </section>

        <p className="text-[12px] text-[#90A1B9]">
          Specs updated April 2026. Platforms tweak these every few months — verify before big campaigns.
        </p>
      </main>
    </div>
  );
}
