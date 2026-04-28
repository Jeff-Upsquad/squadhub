import { supabaseAdmin } from '../supabase';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const ELIGIBLE_USER_TYPES = ['internal', ...PARTNER_USER_TYPES] as const;
const DEFAULT_DEADLINE = '10:00';

/** Resolve a single user's on-time deadline: office_timing.from_time → user_checkin_settings.deadline_time → '10:00' */
export async function resolveDeadlineTime(userId: string): Promise<string> {
  const { data: officeTiming } = await supabaseAdmin
    .from('user_office_timing')
    .select('from_time')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (officeTiming?.from_time) return officeTiming.from_time;

  const { data: settingsRows } = await supabaseAdmin
    .from('user_checkin_settings')
    .select('deadline_time')
    .eq('user_id', userId)
    .limit(1);
  return settingsRows?.[0]?.deadline_time || DEFAULT_DEADLINE;
}

/** Batch deadline resolver — returns a Map<userId, deadline 'HH:MM'> for the given users. */
export async function resolveDeadlineTimes(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const [{ data: timings }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from('user_office_timing')
      .select('user_id, from_time')
      .eq('is_active', true)
      .in('user_id', userIds),
    supabaseAdmin
      .from('user_checkin_settings')
      .select('user_id, deadline_time')
      .in('user_id', userIds),
  ]);

  const out = new Map<string, string>();
  const settingsMap = new Map<string, string>(
    (settings || []).map((s: any) => [s.user_id, s.deadline_time as string])
  );
  const timingMap = new Map<string, string>(
    (timings || []).map((t: any) => [t.user_id, t.from_time as string])
  );

  for (const id of userIds) {
    out.set(id, timingMap.get(id) ?? settingsMap.get(id) ?? DEFAULT_DEADLINE);
  }
  return out;
}

export type EligibleUser = {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  user_type: string;
};

/** Fetch all check-in-eligible users (active internal/partner/partner_employee). */
export async function getEligibleUsers(): Promise<EligibleUser[]> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url, user_type')
    .eq('status', 'active')
    .in('user_type', ELIGIBLE_USER_TYPES as unknown as string[])
    .order('display_name');
  return (data || []) as EligibleUser[];
}

/**
 * Working-day calendar for a date range.
 * Returns the list of working dates (excludes weekends-per-config and all holidays),
 * plus a holiday lookup so callers can label specific dates.
 */
export type WorkingCalendar = {
  workingDates: string[];
  holidayByDate: Map<string, string>; // date -> holiday name
  workingDays: number[]; // dayOfWeek (0=Sun, 6=Sat) that count as working
};

export async function getWorkingCalendar(startDate: string, endDate: string): Promise<WorkingCalendar> {
  const [{ data: wdConfig }, { data: holidays }] = await Promise.all([
    supabaseAdmin.from('working_days_config').select('working_days').limit(1).single(),
    supabaseAdmin.from('holidays').select('*'),
  ]);

  const workingDays: number[] = wdConfig?.working_days || [1, 2, 3, 4, 5, 6];
  const specificHolidays = new Map<string, string>(
    (holidays || [])
      .filter((h: any) => !h.is_recurring && h.date)
      .map((h: any) => [h.date as string, h.name as string])
  );
  const recurringHolidays = (holidays || []).filter((h: any) => h.is_recurring);

  const workingDates: string[] = [];
  const holidayByDate = new Map<string, string>();

  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const cursor = new Date(start);

  while (cursor <= end) {
    const dateStr = cursor.toISOString().split('T')[0];
    const dow = cursor.getUTCDay();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();

    const specific = specificHolidays.get(dateStr);
    const recurring = recurringHolidays.find(
      (h: any) => h.recurring_month === month && h.recurring_day === day
    );

    if (specific) holidayByDate.set(dateStr, specific);
    else if (recurring) holidayByDate.set(dateStr, recurring.name);

    const isWorking = workingDays.includes(dow) && !specific && !recurring;
    if (isWorking) workingDates.push(dateStr);

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { workingDates, holidayByDate, workingDays };
}
