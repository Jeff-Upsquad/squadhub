import { useCallback, useState } from 'react';
import api from '../../../services/api';

export type NoteFileCategory = 'image' | 'audio' | 'video' | 'file';

export interface NoteUploadResult {
  file_url: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  category: NoteFileCategory;
}

export function categorize(mime: string): NoteFileCategory {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

// Upload a file to R2 for the given note (presign via /notes/:id/upload-presign,
// then a direct PUT). Mirrors useUploadAttachment but scoped to a note.
export function useNoteUpload(noteId: string | null) {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File): Promise<NoteUploadResult | null> => {
      if (!noteId) return null;
      setUploading(true);
      const mime = file.type || 'application/octet-stream';
      const category = categorize(mime);
      try {
        const presign = await api.post(`/notes/${noteId}/upload-presign`, {
          filename: file.name,
          content_type: mime,
          file_size: file.size,
          file_category: category,
        });
        const data = presign.data?.data;
        if (!data) throw new Error('Presign failed');

        const putRes = await fetch(data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': mime },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

        return {
          file_url: data.public_url,
          file_name: file.name,
          file_size: file.size,
          file_mime: mime,
          category,
        };
      } finally {
        setUploading(false);
      }
    },
    [noteId],
  );

  return { upload, uploading };
}
