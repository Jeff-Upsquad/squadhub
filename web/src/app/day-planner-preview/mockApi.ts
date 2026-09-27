// In-memory stand-in for the planner's API so /day-planner-preview renders the
// real Day Planner components with no backend or sign-in. Installed as the
// shared axios instance's adapter, so every hook (queries + optimistic
// mutations) runs unchanged; state lives only for the page's lifetime.
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import api from '../../services/api';
import { planDateKey } from '../../hooks/useDayPlanner';

type Space = { id: string; name: string };
type MockTask = Record<string, any> & { id: string; title: string };
type MockPlan = Record<string, any> & { id: string; task_id: string; plan_date: string };

const SPACES = {
  product: { id: 'sp-product', name: 'Product' },
  ops: { id: 'sp-ops', name: 'Operations' },
  growth: { id: 'sp-growth', name: 'Growth' },
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
const allDayTask = task('Q4 launch day', { priority: 'high', space: SPACES.growth, list: LISTS.launch });

const allTasks = new Map<string, MockTask>(
  [...plannerTasks, ...unscheduledTasks, ...scheduled, allDayTask].map((t) => [t.id, t]),
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
  // Everything else (prefs sync, group runs, activity…) — an empty success.
  return ok(config, method === 'get' ? null : {});
};

let installed = false;
export function installPreviewApi() {
  if (installed) return;
  installed = true;
  api.defaults.adapter = adapter;
}
