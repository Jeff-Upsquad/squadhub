'use client';
import { useRef, useState } from 'react';
import api from '../../services/api';

type FileCategory = 'image' | 'audio' | 'video' | 'file';

interface Props {
  itemId: string;
  lessonId: string;
  fileCategory: FileCategory;
  accept: string;                 // e.g. "image/*", "application/pdf", "video/*", "audio/*"
  current?: { url: string | null; name: string | null } | null;
  onUploaded: (file: { url: string; name: string; size: number; mime_type: string }) => void;
}

export default function MediaUploader({ itemId, lessonId, fileCategory, accept, current, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const presignRes = await api.post('/upload/presign-lms', {
        item_id: itemId,
        lesson_id: lessonId,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        file_size: file.size,
        file_category: fileCategory,
      });
      const { uploadUrl, publicUrl } = presignRes.data.data;

      // Direct PUT to R2
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

      onUploaded({ url: publicUrl, name: file.name, size: file.size, mime_type: file.type || 'application/octet-stream' });
      setProgress(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Upload failed');
      setProgress(null);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {current?.url ? (
        <div className="flex items-center gap-2 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm">
          <span className="flex-1 truncate text-[#0F172B]">{current.name || current.url.split('/').pop()}</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded border border-[#E2E8F0] px-2 py-1 text-[12px] text-[#62748E] hover:bg-[#F8FAFC]"
          >
            Replace
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-6 text-sm text-[#62748E] hover:border-[#0F172B] hover:text-[#0F172B]"
          disabled={progress !== null}
        >
          {progress !== null ? `Uploading… ${progress}%` : `Click to upload ${fileCategory}`}
        </button>
      )}
      {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
