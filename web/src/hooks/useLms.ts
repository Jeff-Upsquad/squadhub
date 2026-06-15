import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { LmsAssignment, LmsItem, LmsCategory, LmsLesson } from '@squadhub/shared';

export type MyLearningEntry = LmsAssignment & { item: LmsItem };

export function useMyLearning() {
  return useQuery<MyLearningEntry[]>({
    queryKey: ['my-learning'],
    queryFn: async () => {
      const res = await api.get('/lms/my-items');
      return res.data.data;
    },
  });
}

// Non-completed assignments whose due_date is today or overdue (server-filtered
// in the caller's timezone). Powers the Home "Courses" secondary card.
export function useDueCourses(enabled = true) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return useQuery<MyLearningEntry[]>({
    queryKey: ['lms-due', tz],
    queryFn: async () => {
      const res = await api.get(`/lms/my-due?tz=${encodeURIComponent(tz)}`);
      return res.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useLmsCategories() {
  return useQuery<LmsCategory[]>({
    queryKey: ['lms-categories'],
    queryFn: async () => {
      const res = await api.get('/lms/categories');
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useLmsItem(itemId: string | null) {
  return useQuery<{
    item: LmsItem & { lessons: (LmsLesson & { blocks: any[] })[] };
    assignment: (LmsAssignment & { completed_lesson_ids: string[] }) | null;
  }>({
    queryKey: ['lms-item', itemId],
    queryFn: async () => {
      const res = await api.get(`/lms/items/${itemId}`);
      return res.data.data;
    },
    enabled: !!itemId,
  });
}

export function useStartAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/lms/assignments/${assignmentId}/start`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-learning'] });
    },
  });
}

export function useCompleteLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, lessonId }: { assignmentId: string; lessonId: string }) =>
      api.post(`/lms/assignments/${assignmentId}/lessons/${lessonId}/complete`).then((r) => r.data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['my-learning'] });
      // item cache: invalidate by item_id via assignment_id — we don't have item_id here, so invalidate all
      qc.invalidateQueries({ queryKey: ['lms-item'] });
    },
  });
}

export function useSubmitQuiz() {
  return useMutation({
    mutationFn: ({ assignmentId, blockId, answers }: {
      assignmentId: string;
      blockId: string;
      answers: Record<string, string>;
    }) =>
      api.post(`/lms/assignments/${assignmentId}/quiz/${blockId}/submit`, { answers }).then((r) => r.data),
  });
}
