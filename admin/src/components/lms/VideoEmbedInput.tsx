'use client';
import { useState } from 'react';

interface Props {
  url: string | null;
  onChange: (data: { url: string; provider: string } | null) => void;
}

function detectProvider(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/vimeo\.com/.test(url)) return 'vimeo';
  if (/loom\.com/.test(url)) return 'loom';
  // Squad Clips share links render via the lesson's chrome-free /embed iframe.
  if (/clips\.squadhub\.in|localhost:3200/.test(url)) return 'squadclips';
  return 'other';
}

export default function VideoEmbedInput({ url, onChange }: Props) {
  const [draft, setDraft] = useState(url || '');

  function apply() {
    if (!draft.trim()) {
      onChange(null);
      return;
    }
    try {
      new URL(draft);
      onChange({ url: draft, provider: detectProvider(draft) });
    } catch {
      alert('Please enter a valid URL');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        placeholder="Paste YouTube / Vimeo / Loom URL"
        className="flex-1 rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
      />
      <button
        type="button"
        onClick={apply}
        className="rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt"
      >
        Apply
      </button>
    </div>
  );
}
