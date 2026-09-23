import { useQuery } from '@tanstack/react-query';
import type { MySkills, EditLoggedTimeLevel } from '@squadhub/shared';
import api from '../services/api';

/** The caller's effective level of every skill (admin "Skills" module). */
export function useMySkills() {
  return useQuery<MySkills>({
    queryKey: ['my-skills'],
    queryFn: async () => (await api.get('/users/me/skills')).data.data,
    staleTime: 60_000,
  });
}

/** edit_logged_time level, or null when the caller can only add time. */
export function useEditLoggedTimeLevel(): EditLoggedTimeLevel | null {
  const { data } = useMySkills();
  const level = data?.edit_logged_time;
  return level === 'reduce' || level === 'full' ? level : null;
}
