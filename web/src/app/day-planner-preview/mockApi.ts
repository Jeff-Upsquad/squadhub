// In-memory stand-in for the planner's API so /day-planner-preview renders the
// real Day Planner components with no backend or sign-in. Installed as the
// shared axios instance's adapter, so every hook (queries + optimistic
// mutations) runs unchanged; state lives only for the page's lifetime.
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { planDateKey } from '../../hooks/useDayPlanner';

type Space = { id: string; name: string };
type MockTask = Record<string, any> & { id: string; title: string };
type MockPlan = Record<string, any> & { id: string; task_id: string; plan_date: string };

const SPACES = {
  product: { id: 'sp-product', name: 'Product' },
  ops: { id: 'sp-ops', name: 'Operations' },
  growth: { id: 'sp-growth', name: 'Growth' },
};
const ME = { id: 'u-me', display_name: 'You', email: 'preview@squadhub.local', avatar_url: null };

const STATUSES = [
  { id: 'st-todo', space_id: 'sp', name: 'To do', color: '#94A3B8', position: 0, is_default: true, category: 'todo' },
  { id: 'st-doing', space_id: 'sp', name: 'In progress', color: '#3B82F6', position: 1, is_default: false, category: 'active' },
  { id: 'st-done', space_id: 'sp', name: 'Done', color: '#7C3AED', position: 2, is_default: false, category: 'closed' },
];

const PERSONAL = {
  space: { id: 'sp-personal', name: 'My Tasks' },
  list: { id: 'l-personal', name: 'My Tasks' },
};

const LISTS = {
  web: { id: 'l-web', name: 'Web app' },
  hiring: { id: 'l-hiring', name: 'Hiring' },
  launch: { id: 'l-launch', name: 'Q4 launch' },
  admin: { id: 'l-admin', name: 'Admin' },
};

function iso(daysFromToday: number, hour = 0, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

let seq = 0;
function task(title: string, extra: Partial<MockTask> & { space?: Space; list?: Space }): MockTask {
  seq += 1;
  return {
    id: `t-${seq}`,
    list_id: extra.list?.id ?? 'l-web',
    parent_task_id: null,
    title,
    description: null,
    status_id: 's-open',
    status: null,
    priority: 'normal',
    position: seq,
    due_date: null,
    work_date: null,
    start_date: null,
    focused_at: null,
    snoozed_until: null,
    task_type_id: null,
    time_estimate: null,
    time_tracked: 0,
    metadata: {},
    display_number: seq,
    created_by: 'u-me',
    created_at: iso(-3),
    updated_at: iso(-1),
    folder: null,
    ...extra,
  };
}

const plannerTasks: MockTask[] = [
  task('Review onboarding flow copy with design', { priority: 'urgent', work_date: iso(0), due_date: iso(0), time_estimate: 45, focused_at: iso(0), space: SPACES.product, list: LISTS.web }),
  task('Fix planner drag preview on Safari', { priority: 'high', work_date: iso(0), time_estimate: 90, space: SPACES.product, list: LISTS.web }),
  task('Send offer letter to backend candidate', { priority: 'emergency', due_date: iso(-2), time_estimate: 20, space: SPACES.ops, list: LISTS.hiring }),
  task('Draft launch announcement for the Squad blog', { work_date: iso(0), start_date: iso(1), time_estimate: 60, space: SPACES.growth, list: LISTS.launch }),
  task('Weekly invoice reconciliation', { work_date: iso(0), time_estimate: 30, space: SPACES.ops, list: LISTS.admin }),
  task('Reply to partner feedback thread', { focused_at: iso(0), space: SPACES.growth, list: LISTS.launch }),
  task('Prepare 1:1 notes for Anjali', { work_date: iso(0), time_estimate: 15, space: SPACES.ops, list: LISTS.hiring }),
];

const unscheduledTasks: MockTask[] = [
  task('Clean up stale feature flags', { time_estimate: 40, space: SPACES.product, list: LISTS.web }),
  task('Collect testimonials from beta squads', { space: SPACES.growth, list: LISTS.launch }),
];

const scheduled: MockTask[] = [
  task('Stand-up with product squad', { time_estimate: 15, space: SPACES.product, list: LISTS.web }),
  task('Deep work: calendar sync API', { priority: 'high', time_estimate: 120, space: SPACES.product, list: LISTS.web }),
  task('Interview — senior designer', { priority: 'urgent', time_estimate: 60, space: SPACES.ops, list: LISTS.hiring }),
  task('Inbox zero', { status: 'closed', time_estimate: 30, space: SPACES.ops, list: LISTS.admin }),
  task('Pair on release checklist', { time_estimate: 30, space: SPACES.growth, list: LISTS.launch }),
];
// Later this month — only surfaced by the Month view (via work/due dates).
const upcomingTasks: MockTask[] = [
  task('Quarterly roadmap review', { priority: 'high', work_date: iso(2), time_estimate: 90, space: SPACES.product, list: LISTS.web }),
  task('Renew design tool licences', { due_date: iso(4), space: SPACES.ops, list: LISTS.admin }),
  task('Launch retro with the squad', { work_date: iso(8), time_estimate: 60, space: SPACES.growth, list: LISTS.launch }),
  task('Payroll sign-off', { priority: 'urgent', due_date: iso(-6), space: SPACES.ops, list: LISTS.admin }),
];
const allDayTask = task('Q4 launch day', { priority: 'high', space: SPACES.growth, list: LISTS.launch });

const allTasks = new Map<string, MockTask>(
  [...plannerTasks, ...unscheduledTasks, ...scheduled, ...upcomingTasks, allDayTask].map((t) => [t.id, t]),
);

function embed(t: MockTask) {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    status_id: t.status_id,
    status: t.status ?? null,
    time_estimate: t.time_estimate,
    list_id: t.list_id,
    list: t.list ?? null,
  };
}

const today = planDateKey();
let planSeq = 0;
function plan(t: MockTask, date: string, start: number, dur: number, extra: Partial<MockPlan> = {}): MockPlan {
  planSeq += 1;
  return {
    id: `p-${planSeq}`,
    task_id: t.id,
    user_id: 'u-me',
    plan_date: date,
    start_minute: start,
    duration_minutes: dur,
    created_at: iso(0),
    updated_at: iso(0),
    task: embed(t),
    ...extra,
  };
}

const plans: MockPlan[] = [
  plan(scheduled[0], today, 9 * 60 + 30, 15),
  plan(scheduled[1], today, 10 * 60, 120),
  plan(scheduled[3], today, 8 * 60 + 30, 30),
  plan(scheduled[2], today, 14 * 60, 60),
  plan(scheduled[4], today, 14 * 60 + 30, 30),
  plan(allDayTask, today, 0, 0, { virtual: true, kind: 'date_occurrence', all_day: true, date_field: 'due' }),
];

function ok(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { data: { data }, status, statusText: 'OK', headers: {}, config };
}

const adapter: AxiosAdapter = async (config) => {
  const method = (config.method ?? 'get').toLowerCase();
  const url = new URL(config.url ?? '/', 'http://preview.local');
  const q = url.searchParams;
  const path = url.pathname;
  const body = typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data ?? {};
  // A small delay keeps loading/optimistic states honest.
  await new Promise((r) => setTimeout(r, 120));

  if (method === 'get' && path === '/pm/tasks/my') {
    const now = Date.now();
    const live = (t: MockTask) => !t.snoozed_until || new Date(t.snoozed_until).getTime() <= now;
    return ok(config, {
      day_planner: plannerTasks.filter(live),
      unscheduled: unscheduledTasks.filter(live),
      // The Month view flattens these buckets and places tasks by date, so
      // one bucket holding every dated task is enough here.
      upcoming: [...allTasks.values()].filter((t) => live(t) && (t.work_date || t.due_date)),
    });
  }
  if (path === '/pm/day-plans') {
    if (method === 'get') return ok(config, plans.filter((p) => p.plan_date === q.get('date')));
    if (method === 'post') {
      const existing = plans.find((p) => p.task_id === body.task_id && p.plan_date === body.plan_date && !p.all_day);
      if (existing) {
        Object.assign(existing, { start_minute: body.start_minute, duration_minutes: body.duration_minutes });
        return ok(config, existing);
      }
      const t = allTasks.get(body.task_id);
      if (!t) return ok(config, null, 404);
      const created = plan(t, body.plan_date, body.start_minute, body.duration_minutes);
      plans.push(created);
      return ok(config, created, 201);
    }
    if (method === 'delete') {
      const i = plans.findIndex((p) => p.task_id === q.get('task_id') && p.plan_date === q.get('plan_date') && !p.all_day);
      if (i >= 0) plans.splice(i, 1);
      return ok(config, null);
    }
  }
  // Task panel lookups — the task itself plus the list/space it lives in.
  const getTask = path.match(/^\/pm\/tasks\/([^/]+)$/);
  if (method === 'get' && getTask && allTasks.has(getTask[1])) {
    const t = allTasks.get(getTask[1])!;
    // `status` is the TEXT key on the wire (e.g. 'closed'); status_id points
    // at the space status row.
    const done = t.status === 'closed';
    const statusId = STATUSES.find((st) => (done ? st.category === 'closed' : st.is_default))!.id;
    return ok(config, { ...t, status_id: statusId, status: done ? 'closed' : 'todo', assignees: [ME], tags: [], subtasks: [], comment_count: 0 });
  }
  const getList = path.match(/^\/pm\/lists\/([^/]+)$/);
  if (method === 'get' && getList) {
    const list = Object.values(LISTS).find((l) => l.id === getList[1]);
    const space = [...allTasks.values()].find((t) => t.list?.id === getList[1])?.space ?? SPACES.product;
    return ok(config, { id: getList[1], name: list?.name ?? 'List', space_id: space.id, folder_id: null, space_statuses: STATUSES, my_access_level: 'owner' });
  }
  // "My Tasks" — the private personal space + its default list.
  if (method === 'get' && path === '/pm/personal') {
    return ok(config, { space: { ...PERSONAL.space, statuses: STATUSES }, list: PERSONAL.list });
  }
  if (method === 'post' && path === '/pm/tasks') {
    const list = PERSONAL.list.id === body.list_id ? PERSONAL.list : Object.values(LISTS).find((l) => l.id === body.list_id) ?? PERSONAL.list;
    const created = task(body.title || 'Untitled', {
      ...body,
      priority: body.priority && body.priority !== 'none' ? body.priority : 'normal',
      list,
      space: list === PERSONAL.list ? PERSONAL.space : SPACES.product,
    });
    allTasks.set(created.id, created);
    plannerTasks.push(created);
    return ok(config, created, 201);
  }
  const getSpace = path.match(/^\/pm\/spaces\/([^/]+)$/);
  if (method === 'get' && getSpace) {
    const space = Object.values(SPACES).find((sp) => sp.id === getSpace[1]);
    if (getSpace[1] === PERSONAL.space.id) {
      return ok(config, { ...PERSONAL.space, color: '#0A0A0A', statuses: STATUSES, space_statuses: STATUSES, lists: [PERSONAL.list], folders: [], my_access_level: 'owner' });
    }
    const lists = Object.values(LISTS).filter((l) => [...allTasks.values()].some((t) => t.list?.id === l.id && t.space?.id === getSpace[1]));
    return ok(config, { id: getSpace[1], name: space?.name ?? 'Space', color: '#6366F1', statuses: STATUSES, space_statuses: STATUSES, lists, folders: [], my_access_level: 'owner' });
  }
  const taskMatch = path.match(/^\/pm\/tasks\/([^/]+)(?:\/(focus|snooze))?$/);
  if (taskMatch && (method === 'patch' || method === 'put')) {
    const t = allTasks.get(taskMatch[1]);
    if (t) {
      if (taskMatch[2] === 'focus') t.focused_at = body.focused ? new Date().toISOString() : null;
      else if (taskMatch[2] === 'snooze') t.snoozed_until = body.until ?? null;
      else Object.assign(t, body);
    }
    return ok(config, t ?? null);
  }
  // Everything else (prefs sync, group runs, comments, activity…) — an empty
  // success. Collection lookups dominate, so unknown GETs return [].
  if (method === 'get' && /\/(active|summary|current)$/.test(path)) return ok(config, null);
  return ok(config, method === 'get' ? [] : {});
};

let installed = false;
export function installPreviewApi() {
  if (installed) return;
  installed = true;
  api.defaults.adapter = adapter;
  // A stand-in signed-in user + workspace: the create panel needs both
  // (assignee default, workspace-scoped pickers). Not authenticated.
  useAuthStore.setState({ user: ME as any });
  useWorkspaceStore.setState({ currentWorkspace: { id: 'ws-preview', name: 'Preview' } as any });
}
