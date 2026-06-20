import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import api from '../services/api';
import type {
  Note,
  NoteTreeItem,
  NotePatch,
  NoteSharesResponse,
  NoteTrashItem,
  NoteShare,
  UnfurlResult,
} from '../views/app/notes/types';

// ---- queries ---------------------------------------------------------------

// The sidebar page tree. The server scopes to the caller's workspace + access
// (owned + shared roots), so we only key the cache by workspaceId.
export function useNotesTree(workspaceId: string | undefined) {
  return useQuery<NoteTreeItem[]>({
    queryKey: ['notes', 'tree', workspaceId],
    queryFn: async () => {
      const res = await api.get('/notes');
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}

// One full page. staleTime: Infinity — the editor owns local edits after the
// first load; a background refetch would clobber in-progress changes (saves
// flow one-way via the autosave PATCH below).
export function useNote(noteId: string | null) {
  return useQuery<Note>({
    queryKey: ['notes', 'note', noteId],
    queryFn: async () => {
      const res = await api.get(`/notes/${noteId}`);
      return res.data.data;
    },
    enabled: !!noteId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useNotesTrash(workspaceId: string | undefined) {
  return useQuery<NoteTrashItem[]>({
    queryKey: ['notes', 'trash', workspaceId],
    queryFn: async () => {
      const res = await api.get('/notes/trash');
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}

export function useNoteShares(noteId: string | null) {
  return useQuery<NoteSharesResponse>({
    queryKey: ['notes', 'shares', noteId],
    queryFn: async () => {
      const res = await api.get(`/notes/${noteId}/shares`);
      return res.data.data;
    },
    enabled: !!noteId,
  });
}

// ---- mutations -------------------------------------------------------------

export function useCreateNote(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { parent_id?: string | null; title?: string; icon?: string }) => {
      const res = await api.post('/notes', body);
      return res.data.data as Note;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
    },
  });
}

export function useUpdateNote(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; patch: NotePatch }) => {
      const res = await api.patch(`/notes/${vars.id}`, vars.patch);
      return res.data.data as Note;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
      qc.setQueryData(['notes', 'note', data.id], data);
    },
  });
}

export function useDeleteNote(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/notes/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
      qc.invalidateQueries({ queryKey: ['notes', 'trash', workspaceId] });
    },
  });
}

export function useRestoreNote(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/notes/${id}/restore`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
      qc.invalidateQueries({ queryKey: ['notes', 'trash', workspaceId] });
    },
  });
}

export function useMoveNote(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; parent_id: string | null; position?: number }) => {
      await api.post(`/notes/${vars.id}/move`, { parent_id: vars.parent_id, position: vars.position });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
    },
  });
}

export function useSetNoteShares(noteId: string | null, workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shares: Array<Pick<NoteShare, 'grantee_type' | 'grantee_id' | 'access_level'>>) => {
      const res = await api.put(`/notes/${noteId}/shares`, { shares });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'shares', noteId] });
      qc.invalidateQueries({ queryKey: ['notes', 'tree', workspaceId] });
    },
  });
}

// Bookmark/embed metadata for a pasted URL. Cached by URL.
export function useUnfurl(url: string, opts?: { enabled?: boolean }) {
  return useQuery<UnfurlResult>({
    queryKey: ['notes', 'unfurl', url],
    queryFn: async () => {
      const res = await api.get(`/notes/unfurl?url=${encodeURIComponent(url)}`);
      return res.data.data;
    },
    enabled: (opts?.enabled ?? true) && !!url,
    staleTime: Infinity,
  });
}

// Imperative unfurl (used inside Tiptap node views / paste handler).
export async function fetchUnfurl(url: string): Promise<UnfurlResult | null> {
  try {
    const res = await api.get(`/notes/unfurl?url=${encodeURIComponent(url)}`);
    return res.data.data as UnfurlResult;
  } catch {
    return null;
  }
}

// ---- autosave --------------------------------------------------------------

// Debounced one-way autosave for the open page — mirrors useWhiteboardAutosave.
// Call save(patch) on every edit (coalesces); flush() persists immediately and
// runs on unmount so the last edit is never lost. Deliberately does NOT
// invalidate the note query (that would refetch and clobber local edits).
export function useNoteAutosave(noteId: string | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<NotePatch | null>(null);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    if (patch && noteId) {
      pending.current = null;
      api.patch(`/notes/${noteId}`, patch).catch(() => {});
    }
  }, [noteId]);

  const save = useCallback((patch: NotePatch) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
  }, [flush]);

  useEffect(() => () => flush(), [flush]);

  return { save, flush };
}
