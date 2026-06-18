import { load, type Store } from '@tauri-apps/plugin-store';

/** A list the user has recently sent a quick-add task to. */
export interface RecentList {
  id: string;
  name: string;
}

const KEY = 'recentLists';
const MAX = 8;

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load('recents.json');
  }
  return store;
}

/** Most-recently-used lists first. Quietly returns [] if anything goes wrong. */
export async function getRecentLists(): Promise<RecentList[]> {
  try {
    const s = await getStore();
    const raw = await s.get<RecentList[]>(KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string');
  } catch {
    return [];
  }
}

/**
 * Record that a task was just added to `list`, moving it to the front of the
 * recents (deduped by id, capped at MAX). Best-effort — never throws.
 */
export async function pushRecentList(list: RecentList): Promise<void> {
  try {
    const s = await getStore();
    const existing = await getRecentLists();
    const next = [list, ...existing.filter((r) => r.id !== list.id)].slice(0, MAX);
    await s.set(KEY, next);
    await s.save();
  } catch {
    /* recents are sugar — ignore persistence failures */
  }
}
