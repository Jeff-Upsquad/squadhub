'use client';
import { useRef, useState } from 'react';
import api from '@/services/api';

// Image upload for the Job Cards onboarding profiles (business/brand logos +
// office photos shown to candidates). Presign → direct PUT to R2 → publicUrl,
// mirroring components/lms/MediaUploader.tsx. Theme tokens only — no
// hard-coded hex (globals.css rule).

interface Props {
  kind: 'logo' | 'photo';
  value: string | null;
  onChange: (url: string | null) => void;
  /** Compact square preview (logos) vs wide preview (photos). */
  variant?: 'logo' | 'photo';
  className?: string;
}

export default function ImageUploadField({ kind, value, onChange, variant = 'logo', className = '' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const presignRes = await api.post('/upload/presign-jobs', {
        kind,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        file_size: file.size,
      });
      const { uploadUrl, publicUrl } = presignRes.data.data;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => {
          try {
            const isCrossOrigin = new URL(uploadUrl).origin !== window.location.origin;
            reject(new Error(isCrossOrigin
              ? 'Upload blocked — storage CORS not configured for this domain'
              : 'Network error — check your connection and try again'));
          } catch { reject(new Error('Upload failed')); }
        };
        xhr.send(file);
      });

      onChange(publicUrl);
      setProgress(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Upload failed');
      setProgress(null);
    }
  }

  const isLogo = variant === 'logo';

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={kind === 'logo' ? 'Logo' : 'Photo'}
            className={
              isLogo
                ? 'h-14 w-14 shrink-0 rounded-lg border border-divider bg-surface object-contain p-1'
                : 'h-20 w-32 shrink-0 rounded-lg border border-divider bg-surface object-cover'
            }
          />
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={progress !== null}
              className="rounded-lg border border-divider px-2.5 py-1 text-xs text-foreground-muted transition hover:bg-surface-alt hover:text-foreground"
            >
              {progress !== null ? `Uploading… ${progress}%` : 'Replace'}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg border border-divider px-2.5 py-1 text-xs text-foreground-muted transition hover:bg-surface-alt hover:text-foreground"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={progress !== null}
          className={`flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider-strong bg-surface-alt text-sm text-foreground-muted transition hover:border-foreground-muted hover:text-foreground ${
            isLogo ? 'h-14 w-full px-4' : 'h-20 w-full px-4'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {progress !== null ? `Uploading… ${progress}%` : kind === 'logo' ? 'Upload logo' : 'Upload photo'}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
