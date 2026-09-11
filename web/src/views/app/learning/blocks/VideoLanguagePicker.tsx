'use client';
import { lmsVideoLanguageLabel, type LmsBlockVideo } from '@squadhub/shared';

/**
 * Language switcher shown above a video that has alternates. "Default" is the
 * block's own URL — the one every single-language video has — so a block with
 * no variants renders no picker at all and looks exactly as it did before.
 */
export default function VideoLanguagePicker({
  videos,
  value,
  onChange,
}: {
  videos: LmsBlockVideo[];
  value: string | null;
  onChange: (language: string | null) => void;
}) {
  if (!videos.length) return null;

  const options: { key: string | null; label: string }[] = [
    { key: null, label: 'Default' },
    ...videos.map((v) => ({ key: v.language, label: lmsVideoLanguageLabel(v.language) })),
  ];

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">
        Language
      </span>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key ?? '__default'}
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={`rounded-full border px-2 py-0.5 text-[11.5px] transition ${
              active
                ? 'border-[var(--sh-ink)] bg-[var(--sh-ink)] font-medium text-[var(--sh-bg)]'
                : 'border-[var(--sh-hair)] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
