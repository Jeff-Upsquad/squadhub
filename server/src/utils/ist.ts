import { supabaseAdmin } from '../supabase';

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST(): Date {
  const now = new Date();
  return new Date(now.getTime() + IST_OFFSET_MS);
}

export function todayIST(): string {
  return nowIST().toISOString().split('T')[0];
}

export function formatTimeIST(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

export async function isNonWorkingDay(dateStr: string): Promise<boolean> {
  const date = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = date.getUTCDay();

  const { data: wdConfig } = await supabaseAdmin
    .from('working_days_config')
    .select('working_days')
    .limit(1)
    .single();

  const workingDays: number[] = wdConfig?.working_days || [1, 2, 3, 4, 5, 6];
  if (!workingDays.includes(dayOfWeek)) return true;

  const { data: specificHoliday } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('date', dateStr)
    .eq('is_recurring', false)
    .limit(1);

  if (specificHoliday && specificHoliday.length > 0) return true;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const { data: recurringHoliday } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('is_recurring', true)
    .eq('recurring_month', month)
    .eq('recurring_day', day)
    .limit(1);

  if (recurringHoliday && recurringHoliday.length > 0) return true;

  return false;
}
