import { useState } from 'react';

/**
 * Compact, copyable display of a subscription card's human-readable code
 * (e.g. "CARD-8TOCIA"). Use this anywhere a subscription card is visible so the
 * card can be identified and referenced at a glance instead of by its raw UUID.
 * Renders nothing when the card has no code (legacy rows before card_code).
 */
export default function CardCodeChip({
  code,
  className = '',
}: {
  code: string | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (e.g. insecure context) — ignore
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : 'Copy card code'}
      className={`group inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] font-medium leading-none transition ${className}`}
      style={{
        borderColor: 'var(--color-sh-warm-border)',
        color: 'var(--color-sh-ink-muted)',
        backgroundColor: 'transparent',
      }}
    >
      {code}
      {copied ? (
        <svg className="h-3 w-3" style={{ color: 'var(--color-sh-success)' }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="h-3 w-3 opacity-50 group-hover:opacity-90" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
        </svg>
      )}
    </button>
  );
}
