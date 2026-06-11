'use client';
import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react';
import api from '../../../services/api';
import type { TaskAttachment } from '@squadhub/shared';
import { useTaskAttachments, useDeleteTaskAttachment } from '../../../hooks/useTaskAttachments';
import AttachmentPreview from './AttachmentPreview';

export type TaskAttachmentsHandle = {
  addFiles: (files: FileList | File[]) => void;
};

function isAudioMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith('audio/');
}

const MAX_BYTES = 100 * 1024 * 1024;

type InFlight = {
  id: string;
  file: File;
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE';
}

interface Props {
  taskId: string;
  canEdit: boolean;
  excludeAudio?: boolean;
}

const TaskAttachments = forwardRef<TaskAttachmentsHandle, Props>(function TaskAttachments(
  { taskId, canEdit, excludeAudio },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<InFlight[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data: allAttachments = [], refetch } = useTaskAttachments(taskId);
  const attachments = excludeAudio ? allAttachments.filter((a) => !isAudioMime(a.mime_type)) : allAttachments;
  const deleteMut = useDeleteTaskAttachment(taskId);

  const updateInFlight = useCallback((id: string, patch: Partial<InFlight>) => {
    setInFlight((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const removeInFlight = useCallback((id: string) => {
    setInFlight((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const uploadOne = useCallback(async (file: File) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    if (file.size > MAX_BYTES) {
      setInFlight((prev) => [
        ...prev,
        { id, file, progress: 0, error: `Max file size is ${MAX_BYTES / 1024 / 1024} MB` },
      ]);
      return;
    }

    setInFlight((prev) => [...prev, { id, file, progress: 0 }]);

    try {
      const presignRes = await api.post('/pm/task-attachments/presign', {
        task_id: taskId,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        file_size: file.size,
      });
      const { upload_url, key } = presignRes.data.data;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            updateInFlight(id, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => {
          try {
            const isCrossOrigin = new URL(upload_url).origin !== window.location.origin;
            reject(new Error(isCrossOrigin
              ? 'Upload blocked — storage CORS not configured for this domain'
              : 'Network error — check your connection and try again'));
          } catch { reject(new Error('Upload failed')); }
        };
        xhr.onabort = () => reject(new Error('Cancelled'));
        updateInFlight(id, { xhr });
        xhr.send(file);
      });

      await api.post('/pm/task-attachments/confirm', {
        task_id: taskId,
        object_key: key,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
      });

      removeInFlight(id);
      refetch();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ||
        (err as { message?: string })?.message ||
        'Upload failed';
      updateInFlight(id, { error: msg, xhr: undefined });
    }
  }, [taskId, updateInFlight, removeInFlight, refetch]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => uploadOne(f));
  }, [uploadOne]);

  useImperativeHandle(ref, () => ({ addFiles: handleFiles }), [handleFiles]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const onDelete = async (att: TaskAttachment) => {
    if (!confirm(`Delete "${att.file_name}"?`)) return;
    try {
      await deleteMut.mutateAsync(att.id);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ||
        (err as { message?: string })?.message ||
        'Delete failed';
      alert(msg);
    }
  };

  const cancelInFlight = (item: InFlight) => {
    if (item.xhr) item.xhr.abort();
    removeInFlight(item.id);
  };

  return (
    <div className="flex flex-col gap-2">
      {canEdit && (
        <div
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
          onDragLeave={(e) => { e.stopPropagation(); setDragOver(false); }}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed py-5 text-[13px] transition-colors"
          style={{
            borderColor: dragOver ? 'var(--sh-ink-3)' : 'var(--sh-hair-3)',
            background: dragOver ? 'var(--sh-hair-1, rgba(0,0,0,0.02))' : 'transparent',
            color: 'var(--sh-ink-2)',
          }}
        >
          <span>Drop files here or click to upload · max 100 MB</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPick}
          />
        </div>
      )}

      {inFlight.map((item) => (
        <div
          key={item.id}
          className="td-file flex items-center gap-3 p-3 rounded-xl border"
          style={{ borderColor: 'var(--sh-hair-3)' }}
        >
          <div className="td-doc-icon">{fileExtension(item.file.name)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-[color:var(--sh-ink)] truncate">{item.file.name}</div>
            {item.error ? (
              <div className="text-[11.5px] text-red-600 mt-0.5">{item.error}</div>
            ) : (
              <>
                <div className="text-[11.5px] text-[color:var(--sh-ink-3)] mt-0.5">
                  {formatSize(item.file.size)} · Uploading {item.progress}%
                </div>
                <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--sh-hair)' }}>
                  <div
                    className="h-full transition-all"
                    style={{ width: `${item.progress}%`, background: 'var(--sh-ink-2)' }}
                  />
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => cancelInFlight(item)}
            className="text-[11px] px-2 py-1 rounded text-[color:var(--sh-ink-3)] hover:text-[color:var(--sh-ink)]"
          >
            {item.error ? 'Dismiss' : 'Cancel'}
          </button>
        </div>
      ))}

      {attachments.length > 0 ? attachments.map((f) =>
        isAudioMime(f.mime_type) ? (
          <AudioAttachment key={f.id} attachment={f} canEdit={canEdit} onDelete={() => onDelete(f)} deleting={deleteMut.isPending} />
        ) : (
          <div
            key={f.id}
            className="td-file flex items-center gap-3 p-3 rounded-xl border"
            style={{ borderColor: 'var(--sh-hair-3)' }}
          >
            {/* Opens the in-panel preview (was: open file in a new tab) */}
            <button
              type="button"
              onClick={() => setPreviewId(f.id)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              title="Preview"
            >
              {f.mime_type?.startsWith('image/') ? (
                <img
                  src={f.file_url}
                  alt=""
                  loading="lazy"
                  className="h-10 w-10 shrink-0 rounded-lg border object-cover"
                  style={{ borderColor: 'var(--sh-hair-3)' }}
                />
              ) : (
                <div className="td-doc-icon">{fileExtension(f.file_name)}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="block text-[13.5px] font-medium text-[color:var(--sh-ink)] truncate hover:underline">
                  {f.file_name}
                </div>
                <div className="text-[11.5px] text-[color:var(--sh-ink-3)] mt-0.5">{formatSize(f.file_size)}</div>
              </div>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => onDelete(f)}
                disabled={deleteMut.isPending}
                className="text-[14px] leading-none w-7 h-7 rounded text-[color:var(--sh-ink-3)] hover:text-red-600 hover:bg-[color:var(--sh-hair-1)] disabled:opacity-40"
                title="Delete"
                aria-label="Delete attachment"
              >
                ×
              </button>
            )}
          </div>
        )
      ) : inFlight.length === 0 ? (
        <div className="text-[13px] text-[color:var(--sh-ink-3)] py-2">No files yet.</div>
      ) : null}

      {previewId && (
        <AttachmentPreview
          attachments={attachments}
          openId={previewId}
          onNavigate={setPreviewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
});

export default TaskAttachments;

const SPEEDS = [0.5, 1, 1.5, 2] as const;

function AudioAttachment({
  attachment,
  canEdit,
  onDelete,
  deleting,
}: {
  attachment: TaskAttachment;
  canEdit: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);

  useEffect(() => {
    const audio = new Audio(attachment.file_url);
    audioRef.current = audio;
    audio.playbackRate = speed;
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ''; cancelAnimationFrame(rafRef.current); };
  }, [attachment.file_url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const tick = () => {
    const a = audioRef.current;
    if (a && a.duration) setProgress(a.currentTime / a.duration);
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    } else {
      a.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    setProgress(pct);
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed as typeof SPEEDS[number]);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const currentTime = audioRef.current?.currentTime || 0;

  return (
    <div className="td-voice-note">
      <button type="button" onClick={togglePlay} className="td-voice-play">
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
        )}
      </button>

      <div className="td-voice-track" onClick={seek}>
        <div className="td-voice-track-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <span className="td-voice-time">{fmtTime(playing ? currentTime : duration)}</span>

      <button type="button" onClick={cycleSpeed} className="td-voice-speed">
        {speed}x
      </button>

      {canEdit && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="td-voice-del"
          title="Delete"
        >
          ×
        </button>
      )}
    </div>
  );
}
