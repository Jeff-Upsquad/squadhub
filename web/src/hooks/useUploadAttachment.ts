import { useCallback, useState } from 'react';
import api from '../services/api';
import type { ChatKind } from '../stores/workspaceStore';

export type AttachmentCategory = 'image' | 'audio' | 'video' | 'file';

export interface UploadResult {
  file_url: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  category: AttachmentCategory;
}

// Map MIME -> category and a "type" the chat API expects.
export function categorize(mime: string): AttachmentCategory {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export function useUploadAttachment(scope: ChatKind, scopeId: string | null) {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File | Blob, overrideName?: string, overrideMime?: string): Promise<UploadResult | null> => {
      if (!scopeId) return null;
      setUploading(true);
      setProgress(0);

      const name = overrideName || (file instanceof File ? file.name : 'recording.webm');
      const mime = overrideMime || (file as File).type || 'application/octet-stream';
      const category = categorize(mime);

      try {
        // 1. Get presigned URL
        const presign = await api.post('/messages/upload-presign', {
          scope,
          scope_id: scopeId,
          filename: name,
          content_type: mime,
          file_size: (file as File).size ?? (file as Blob).size,
          file_category: category,
        });
        const data = presign.data?.data;
        if (!data) throw new Error('Presign failed');

        // 2. PUT to R2 with progress.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', data.upload_url, true);
          xhr.setRequestHeader('Content-Type', mime);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
          xhr.onerror = () => reject(new Error('Upload network error'));
          xhr.send(file);
        });

        return {
          file_url: data.public_url,
          file_name: name,
          file_size: (file as File).size ?? (file as Blob).size,
          file_mime: mime,
          category,
        };
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [scope, scopeId],
  );

  return { upload, uploading, progress };
}
