import React from 'react';
import { URL_PATTERN, splitTrailingPunct, toHref } from './urlPattern';

const URL_RE = new RegExp(URL_PATTERN, 'gi');

export function linkifyText(text: string): React.ReactNode {
  if (!text) return text;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const { url, tail } = splitTrailingPunct(m[0]);
    const href = toHref(url);
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
