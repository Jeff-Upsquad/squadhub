import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  registerTaskStatusDefs,
  statusGroupRowToTaskDef,
  type SpaceStatus,
  type StatusGroup,
  type StatusGroupStatus,
} from '@squadhub/shared';
import api from '../services/api';

/**
 * Every enabled status group's statuses, merged by key — for views that span
 * lists on different workflows (Space / Folder pages), where one list may use
 * Design stages and another Software stages. Each entry carries its picker
 * section so those views can group statuses under Not started / Active / …
 * The first group to define a key wins: stage workflows first, Default Task
 * Statuses last, so shared keys (closed, on_hold…) keep stage-workflow
 * labels and placeholder flags.
 */
export function useStatusDirectory(): SpaceStatus[] {
  const { data } = useQuery({
    queryKey: ['status-groups', 'directory'],
    queryFn: () => api.get('/pm/status-groups').then((r) => (r.data?.data || []) as StatusGroup[]),
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    // Stage workflows first (their placeholder flags + labels win for shared
    // keys), Default Task Statuses last.
    const rank = (g: StatusGroup) => (g.is_stage_workflow ? 0 : g.key === 'task_workflow' ? 2 : 1);
    const groups = [...(data || [])].sort((a, b) => rank(a) - rank(b));
    const byKey = new Map<string, SpaceStatus>();
    for (const g of groups) {
      for (const row of (g.statuses || []) as StatusGroupStatus[]) {
        const def = statusGroupRowToTaskDef(row);
        if (!def.key || byKey.has(def.key)) continue;
        byKey.set(def.key, {
          id: def.key,
          space_id: '',
          name: def.label,
          color: def.color,
          position: byKey.size,
          is_default: !!def.is_default,
          category: def.category,
          group: def.group,
          groupLabel: def.groupLabel,
          groupEmoji: def.groupEmoji,
          description: def.description,
          is_placeholder: def.is_placeholder,
        });
      }
    }
    const list = [...byKey.values()];
    if (list.length > 0) {
      registerTaskStatusDefs(list.map((s) => ({
        key: s.id as any,
        label: s.name,
        description: s.description || '',
        group: s.group as any,
        groupLabel: s.groupLabel || '',
        groupEmoji: s.groupEmoji || '',
        category: s.category,
        color: s.color,
        is_default: s.is_default,
        is_placeholder: s.is_placeholder,
      })));
    }
    return list;
  }, [data]);
}
