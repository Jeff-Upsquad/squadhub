'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CardShareLink } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Coarse human countdown ("3h 12m", "8m", "expired"). Re-rendered on a tick.
function countdown(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Generate / copy / revoke the 24h client pre-fill link for one form-request
 * draft card. Used from both the card editor and the Form Requests row.
 */
export default function ShareCardLinkModal({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['card-share-link', cardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${cardId}/share-link`).then((r) => r.data),
  });
  const link: CardShareLink | null = data?.data ?? null;
  const isActive = link?.status === 'active';

  const generate = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${cardId}/share-link`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card-share-link', cardId] });
      setConfirmRegen(false);
      showToast('Shareable link generated', 'success');
    },
    onError: (err: any) => {
      setConfirmRegen(false);
      showToast(err?.response?.data?.error || err.message || 'Failed to generate link', 'error');
    },
  });

  const revoke = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${cardId}/share-link/revoke`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card-share-link', cardId] });
      showToast('Link revoked', 'success');
    },
    onError: (err: any) =>
      showToast(err?.response?.data?.error || err.message || 'Failed to revoke link', 'error'),
  });

  function copy() {
    if (!link?.url) return;
    navigator.clipboard.writeText(link.url);
    setCopied(true);
    showToast('Link copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="sh-card relative w-full max-w-md p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-sh-ink)]">Shareable link</h3>
            <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">
              Send this to the client to confirm the brief. It opens pre-filled from this card and
              expires 24 hours after you generate it.
            </p>
          </div>
          <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm shrink-0">
            Close
          </button>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-[var(--color-sh-ink-muted)]">Loading…</p>
        ) : isActive && link ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-3 py-2 text-sm text-[var(--color-sh-ink)]"
              />
              <button onClick={copy} className="sh-btn-primary sh-btn-primary-sm shrink-0">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-[var(--color-sh-ink-muted)]">
              Expires in {countdown(link.expires_at, now)} · {formatExpiry(link.expires_at)}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setConfirmRegen(true)}
                disabled={generate.isPending}
                className="sh-btn-ghost sh-btn-ghost-sm"
              >
                Regenerate
              </button>
              <button
                onClick={() => revoke.mutate()}
                disabled={revoke.isPending}
                className="sh-btn-ghost sh-btn-ghost-sm"
              >
                {revoke.isPending ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-sh-ink-muted)]">
              {link?.status === 'completed'
                ? 'The client already submitted via the previous link. Generate a new one to collect updates again.'
                : link?.status === 'expired'
                ? 'The previous link has expired. Generate a new one to share again.'
                : link?.status === 'revoked'
                ? 'The previous link was revoked. Generate a new one to share again.'
                : 'No link yet. Generate one to share this brief with the client.'}
            </p>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="sh-btn-primary sh-btn-primary-sm"
            >
              {generate.isPending ? 'Generating…' : 'Generate shareable link'}
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate link?"
        description="This invalidates the current link immediately — anyone you already shared it with will get an error and need the new link."
        confirmLabel="Regenerate"
        variant="warning"
        isPending={generate.isPending}
        pendingLabel="Regenerating…"
        onCancel={() => setConfirmRegen(false)}
        onConfirm={() => generate.mutate()}
      />
    </div>
  );
}
