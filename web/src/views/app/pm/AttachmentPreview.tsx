'use client';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { TaskAttachment } from '@squadhub/shared';
import api from '../../../services/api';

// Full-screen in-app preview for task attachments. Replaces the old
// open-in-new-tab behavior; the new-tab and download actions live in the
// header instead. z-[110] sits above the task panel (z-[90]) and its
// drag overlay (z-[100]).

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'other';

function kindOf(att: TaskAttachment): Kind {
  const mime = att.mime_type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

// Ask the API for a short-lived R2 URL with Content-Disposition: attachment
// so the browser downloads under the original filename (public URLs + the
// download attribute alone don't force a save for images/PDFs). Falls back
// to a blob save, then a new tab if signing fails.
async function downloadAttachment(att: TaskAttachment) {
  try {
    const { data } = await api.get(`/pm/task-attachments/${att.id}/download`);
    const signedUrl = data?.data?.url as string | undefined;
    if (!signedUrl) throw new Error('No download URL');
    const a = document.createElement('a');
    a.href = signedUrl;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  } catch {
    // fall through
  }

  try {
    const res = await fetch(att.file_url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.file_name || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    window.open(att.file_url, '_blank', 'noopener,noreferrer');
  }
}

interface Props {
  attachments: TaskAttachment[];
  openId: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}

export default function AttachmentPreview({ attachments, openId, onNavigate, onClose }: Props) {
  const idx = attachments.findIndex((a) => a.id === openId);
  const att = idx >= 0 ? attachments[idx] : null;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < attachments.length - 1;

  const goPrev = useCallback(() => {
    if (idx > 0) onNavigate(attachments[idx - 1].id);
  }, [idx, attachments, onNavigate]);
  const goNext = useCallback(() => {
    if (idx >= 0 && idx < attachments.length - 1) onNavigate(attachments[idx + 1].id);
  }, [idx, attachments, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goPrev, goNext]);

  if (!att) return null;
  const kind = kindOf(att);

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex flex-col"
      style={{ background: 'rgba(10,10,12,0.82)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${att.file_name}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white">{att.file_name}</div>
          <div className="text-[11.5px] text-white/60">{fmtSize(att.file_size)}</div>
        </div>
        <button
          type="button"
          onClick={() => downloadAttachment(att)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
          title="Download"
          aria-label="Download"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </button>
        <a
          href={att.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
          title="Open in new tab"
          aria-label="Open in new tab"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/75 hover:bg-white/10 hover:text-white"
          title="Close (Esc)"
          aria-label="Close preview"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="Previous (←)"
            aria-label="Previous attachment"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        <div className="flex max-h-full max-w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {kind === 'image' && (
            <img
              src={att.file_url}
              alt={att.file_name}
              className="max-h-[82vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
            />
          )}
          {kind === 'pdf' && (
            <object
              data={att.file_url}
              type="application/pdf"
              className="h-[82vh] w-[88vw] max-w-[1100px] rounded-lg bg-white shadow-2xl"
            >
              <PreviewFallback att={att} note="Your browser can't display this PDF inline." />
            </object>
          )}
          {kind === 'video' && (
            <video
              src={att.file_url}
              controls
              autoPlay
              className="max-h-[82vh] max-w-[88vw] rounded-lg shadow-2xl"
            />
          )}
          {kind === 'audio' && (
            <div className="rounded-xl bg-white/10 p-6">
              <audio src={att.file_url} controls autoPlay className="w-[420px] max-w-[80vw]" />
            </div>
          )}
          {kind === 'other' && <PreviewFallback att={att} note="No inline preview for this file type." />}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="Next (→)"
            aria-label="Next attachment"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Position indicator */}
      {attachments.length > 1 && (
        <div className="pb-3 text-center text-[11.5px] text-white/50" onClick={(e) => e.stopPropagation()}>
          {idx + 1} of {attachments.length}
        </div>
      )}
    </div>,
    document.body,
  );
}

function PreviewFallback({ att, note }: { att: TaskAttachment; note: string }) {
  const ext = att.file_name.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE';
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-white/[0.07] px-12 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/15 text-[13px] font-bold text-white">
        {ext}
      </div>
      <div className="max-w-[420px]">
        <div className="truncate text-[14px] font-semibold text-white">{att.file_name}</div>
        <div className="mt-1 text-[12px] text-white/60">{note}</div>
      </div>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => downloadAttachment(att)}
          className="rounded-lg bg-white px-4 py-1.5 text-[12.5px] font-semibold text-black hover:bg-white/90"
        >
          Download
        </button>
        <a
          href={att.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/20"
        >
          Open in new tab
        </a>
      </div>
    </div>
  );
}
