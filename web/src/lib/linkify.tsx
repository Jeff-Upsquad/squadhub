import React from 'react';

const URL_RE = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+)/gi;

function trimTrailingPunct(url: string): { url: string; tail: string } {
  const m = url.match(/[.,!?;:)\]}'"]+$/);
  if (!m) return { url, tail: '' };
  return { url: url.slice(0, url.length - m[0].length), tail: m[0] };
}

export function linkifyText(text: string): React.ReactNode {
  if (!text) return text;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const { url, tail } = trimTrailingPunct(m[0]);
    const href = url.startsWith('www.') ? `https://${url}` : url;
    out.push(
      <a
        key={i++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="underline text-[var(--sh-accent)] hover:opacity-80"
      >
        {url}
      </a>
    );
    if (tail) out.push(tail);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
