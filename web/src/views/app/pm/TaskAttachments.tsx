'use client';
import { useRef, useState, useCallback } from 'react';
import api from '../../../services/api';
import type { TaskAttachment } from '@squadhub/shared';
import { useTaskAttachments, useDeleteTaskAttachment } from '../../../hooks/useTaskAttachments';

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
}

export default function TaskAttachments({ taskId, canEdit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<InFlight[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const { data: attachments = [], refetch } = useTaskAttachments(taskId);
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
        xhr.onerror = () => reject(new Error('Network error'));
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

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
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
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
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

      {attachments.length > 0 ? attachments.map((f) => (
        <div
          key={f.id}
          className="td-file flex items-center gap-3 p-3 rounded-xl border"
          style={{ borderColor: 'var(--sh-hair-3)' }}
        >
          <div className="td-doc-icon">{fileExtension(f.file_name)}</div>
          <div className="flex-1 min-w-0">
            <a
              href={f.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[13.5px] font-medium text-[color:var(--sh-ink)] truncate hover:underline"
            >
              {f.file_name}
            </a>
            <div className="text-[11.5px] text-[color:var(--sh-ink-3)] mt-0.5">{formatSize(f.file_size)}</div>
          </div>
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
      )) : inFlight.length === 0 ? (
        <div className="text-[13px] text-[color:var(--sh-ink-3)] py-2">No files yet.</div>
      ) : null}
    </div>
  );
}
