import { stageMetaFor, type SpaceStatus, type TaskStatusDef } from '@squadhub/shared';

// A task sits in one STAGE and one STATUS inside it. Stages are the picker
// sections of the list's stage group; these helpers fold a flat status list
// (catalog defs or SpaceStatus rows) into ordered stages.

export type Stage<T> = {
  key: string;
  label: string;
  emoji: string;
  color: string;
  position: number;
  /** Pickable statuses, in workflow order (placeholders excluded). */
  statuses: T[];
  /** Placeholder statuses that live in this stage (e.g. Unblocked). */
  placeholders: T[];
};

type StageFields = {
  group?: string | null;
  groupLabel?: string | null;
  groupEmoji?: string | null;
  groupColor?: string | null;
  groupPosition?: number | null;
  is_placeholder?: boolean;
};

function build<T extends StageFields>(items: T[], isLegacy: (t: T) => boolean): Stage<T>[] {
  const map = new Map<string, Stage<T>>();
  let order = 0;
  for (const it of items) {
    if (isLegacy(it)) continue;
    const key = it.group || 'not_started';
    let st = map.get(key);
    if (!st) {
      const meta = stageMetaFor(key);
      st = {
        key,
        label: it.groupLabel || meta?.label || key,
        emoji: it.groupEmoji || meta?.emoji || '📋',
        color: it.groupColor || meta?.color || '#A0A0A0',
        position: it.groupPosition ?? meta?.position ?? 1000 + order,
        statuses: [],
        placeholders: [],
      };
      map.set(key, st);
      order++;
    }
    (it.is_placeholder ? st.placeholders : st.statuses).push(it);
  }
  return [...map.values()].sort((a, b) => a.position - b.position);
}

export function stagesFromDefs(defs: TaskStatusDef[]): Stage<TaskStatusDef>[] {
  return build(defs, (d) => !!d.is_legacy);
}

export function stagesFromStatuses(statuses: SpaceStatus[]): Stage<SpaceStatus>[] {
  return build(statuses, () => false);
}

/** Closed-stage statuses that mean "finished" (hidden behind "N completed"). */
export function isFinishedCategory(category: string | null | undefined): boolean {
  return category === 'closed' || category === 'done';
}
