import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { LmsAccessLevel, LmsItem, LmsLesson, LmsItemComment } from '@squadhub/shared';

export type FullItem = LmsItem & { lessons: (LmsLesson & { blocks: any[] })[] };

export type SharedEntry = { item: LmsItem; access_level: LmsAccessLevel };

// Published items shared with the user (directly or via a role), incl. ones
// with no learner assignment — for a "Shared with me" catalog group.
export function useSharedWithMe() {
  return useQuery<SharedEntry[]>({
    queryKey: ['lms-shared-with-me'],
    queryFn: async () => (await api.get('/lms/shared-with-me')).data.data,
    staleTime: 60_000,
  });
}

// Full editable item (live for admins, or the contributor's draft clone).
export function useCollabFull(itemId: string | null) {
  return useQuery<FullItem>({
    queryKey: ['lms-collab-full', itemId],
    queryFn: async () => (await api.get(`/lms/collab/items/${itemId}/full`)).data.data,
    enabled: !!itemId,
  });
}

// Open (or resume) an editing session on a live item. Returns the id to edit
// (the live item for admins, or a draft clone for contributors).
export function useStartEditDraft() {
  return useMutation({
    mutationFn: async (liveItemId: string) =>
      (await api.post(`/lms/collab/items/${liveItemId}/edit-draft`)).data.data as {
        draft_item_id: string;
        is_clone: boolean;
        review_state?: string;
      },
  });
}

export function useSubmitReview() {
  return useMutation({
    mutationFn: (draftItemId: string) => api.post(`/lms/collab/items/${draftItemId}/submit-review`),
  });
}

export function useDiscardDraft() {
  return useMutation({
    mutationFn: (draftItemId: string) => api.delete(`/lms/collab/items/${draftItemId}/draft`),
  });
}

// ---- Comments (staff-only) ----
export function useLmsComments(itemId: string | null, enabled: boolean) {
  return useQuery<LmsItemComment[]>({
    queryKey: ['lms-comments', itemId],
    queryFn: async () => (await api.get(`/lms/collab/items/${itemId}/comments`)).data.data,
    enabled: enabled && !!itemId,
  });
}

export function useCommentMutations(itemId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['lms-comments', itemId] });
  const post = useMutation({
    mutationFn: (body: string) => api.post(`/lms/collab/items/${itemId}/comments`, { body }),
    onSuccess: invalidate,
  });
  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api.patch(`/lms/collab/comments/${id}`, { resolved }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/lms/collab/comments/${id}`),
    onSuccess: invalidate,
  });
  return { post, resolve, remove };
}

// ---- Shared cache invalidation for editor mutations ----
export function useEditorMutations(draftItemId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['lms-collab-full', draftItemId] });

  const patchItem = useMutation({
    mutationFn: (body: any) => api.patch(`/lms/collab/items/${draftItemId}`, body),
    onSuccess: invalidate,
  });
  const addLesson = useMutation({
    mutationFn: (body: any = {}) => api.post(`/lms/collab/items/${draftItemId}/lessons`, body),
    onSuccess: invalidate,
  });
  const patchLesson = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/lms/collab/lessons/${id}`, body),
    onSuccess: invalidate,
  });
  const deleteLesson = useMutation({
    mutationFn: (id: string) => api.delete(`/lms/collab/lessons/${id}`),
    onSuccess: invalidate,
  });
  // Replace a page's "hidden from" set (roles/users). Overrides come back in
  // the next /full, so just invalidate.
  const setLessonAccess = useMutation({
    mutationFn: ({ lessonId, overrides }: { lessonId: string; overrides: { principal_type: 'user' | 'role'; principal_id: string }[] }) =>
      api.put(`/lms/collab/lessons/${lessonId}/access`, { overrides }),
    onSuccess: invalidate,
  });
  const addBlock = useMutation({
    mutationFn: ({ lessonId, type }: { lessonId: string; type: string }) =>
      api.post(`/lms/collab/lessons/${lessonId}/blocks`, { type }),
    onSuccess: invalidate,
  });
  const patchBlock = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/lms/collab/blocks/${id}`, body),
    onSuccess: invalidate,
  });
  const deleteBlock = useMutation({
    mutationFn: (id: string) => api.delete(`/lms/collab/blocks/${id}`),
    onSuccess: invalidate,
  });
  const reorderBlocks = useMutation({
    mutationFn: ({ lessonId, items }: { lessonId: string; items: { id: string; position: number }[] }) =>
      api.put(`/lms/collab/lessons/${lessonId}/blocks/reorder`, { items }),
    onSuccess: invalidate,
  });
  return { patchItem, addLesson, patchLesson, deleteLesson, setLessonAccess, addBlock, patchBlock, deleteBlock, reorderBlocks };
}

// Roles + user search for the per-page "hide from" picker.
export function useCollabRoles(enabled: boolean) {
  return useQuery<{ id: string; name: string; color: string | null }[]>({
    queryKey: ['lms-collab-roles'],
    queryFn: async () => (await api.get('/lms/collab/principals/roles')).data.data,
    enabled,
    staleTime: 5 * 60_000,
  });
}
export function useCollabUserSearch(q: string, enabled: boolean) {
  return useQuery<{ id: string; display_name: string | null; email: string | null; avatar_url: string | null }[]>({
    queryKey: ['lms-collab-users', q],
    queryFn: async () => (await api.get(`/lms/collab/principals/users?q=${encodeURIComponent(q)}`)).data.data,
    enabled,
    staleTime: 30_000,
  });
}
