import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../../services/api';
import { IconClose, IconPlus } from './atoms/Icons';
import type { DesignSpaceShareLink } from '@squadhub/shared';

// ---------------------------------------------------------------------------
// Public client link: a persistent, no-login link a CLIENT opens (on mobile) to
// view every design/video space under this client folder (Dashboard / Reports /
// Completed), switch between spaces, and submit requests. Managed against
// /pm/folders/:id/share-link (manager only) where :id is the client folder.
// ---------------------------------------------------------------------------
export default function PublicClientLink({
  folderId,
  folderName,
  onClose,
}: {
  folderId: string;
  folderName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: link, isLoading } = useQuery<DesignSpaceShareLink | null>({
    queryKey: ['design-share-link', folderId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${folderId}/share-link`);
      return res.data.data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['design-share-link', folderId] });

  const generate = useMutation({
    mutationFn: (rotate?: boolean) =>
      api.post(`/pm/folders/${folderId}/share-link${rotate ? '?rotate=1' : ''}`),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/pm/folders/${folderId}/share-link`, { enabled }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/pm/folders/${folderId}/share-link`),
    onSuccess: invalidate,
  });

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="cd-root" style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div className="cd-modal-backdrop" onClick={onClose}>
        <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cd-modal-head">
            <span className="tag">PUBLIC LINK</span>
            <span className="cd-modal-title">{folderName}</span>
            <button className="cd-modal-close" onClick={onClose} aria-label="Close">
              <IconClose size={14} />
            </button>
          </div>

          <div className="cd-modal-body">
            <p style={{ fontSize: 12, color: 'var(--cd-fg-2)', margin: '4px 0 12px' }}>
              Anyone with this link can view this client&apos;s spaces (Dashboard, Reports,
              Completed), switch between them, and submit new requests — no login required.
            </p>

            {isLoading ? (
              <p style={{ fontSize: 11.5, color: 'var(--cd-fg-3)' }}>Loading…</p>
            ) : !link ? (
              <button
                className="cd-btn primary"
                type="button"
                disabled={generate.isPending}
                onClick={() => generate.mutate(false)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <IconPlus size={12} /> {generate.isPending ? 'Generating…' : 'Generate public link'}
              </button>
            ) : (
              <div
                style={{
                  border: '1px solid var(--cd-br-1)',
                  borderRadius: 8,
                  padding: 10,
                  background: 'var(--cd-bg-2)',
                  opacity: link.enabled ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    readOnly
                    value={link.url}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'var(--cd-bg-1)',
                      border: '1px solid var(--cd-br-1)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      fontSize: 11.5,
                      fontFamily: 'var(--cd-font-mono)',
                      color: 'var(--cd-fg-1)',
                    }}
                  />
                  <button className="cd-btn" type="button" onClick={copy} style={{ flexShrink: 0 }}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--cd-fg-1)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={link.enabled}
                      disabled={toggle.isPending}
                      onChange={(e) => toggle.mutate(e.target.checked)}
                    />
                    {link.enabled ? 'Enabled' : 'Disabled'}
                  </label>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      className="cd-btn"
                      type="button"
                      disabled={generate.isPending}
                      onClick={() => {
                        if (window.confirm('Generate a new link? The current link will stop working.')) {
                          generate.mutate(true);
                        }
                      }}
                    >
                      Regenerate
                    </button>
                    <button
                      className="cd-btn"
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm('Delete this public link? It will stop working immediately.')) {
                          remove.mutate();
                        }
                      }}
                      style={{ color: 'var(--cd-danger, #dc2626)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="cd-modal-foot">
            <div className="estimate" />
            <button className="cd-btn" onClick={onClose} type="button">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
