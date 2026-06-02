import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { HoursDay } from '../views/app/pm/client-design/atoms/HoursBars';

export interface DesignPlan {
  name: string;
  dailyHours: number;
  weeklyHours: number;
  monthlyHours: number;
  usedToday: number;
  usedWeek: number;
  usedMonth: number;
  days: HoursDay[];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - diff);
  return out;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DailySummary {
  date: string;
  total_work_seconds: number;
}

export function useClientDesignPlan(folderId?: string): DesignPlan {
  const user = useAuthStore((s) => s.user);

  const { data: linkData } = useQuery({
    queryKey: ['folder-link-status', folderId],
    queryFn: () => api.get(`/pm/folders/${folderId}/link-status`).then((r) => r.data?.data),
    enabled: !!folderId,
  });

  const dailyHours = linkData?.daily_hours ?? 4;
  const weeklyHours = linkData?.weekly_hours ?? 20;
  const monthlyHours = linkData?.prorated_monthly_hours ?? linkData?.monthly_hours ?? dailyHours * 20;

  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const now = new Date();
  const monthStart = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const { data: summariesRes } = useQuery({
    queryKey: ['folder-time-summary', folderId, toISODate(weekStart)],
    queryFn: async () => {
      try {
        const res = await api.get(
          `/pm/folders/${folderId}/time-summary?from=${toISODate(weekStart)}&to=${toISODate(weekEnd)}`,
        );
        return res.data.data as DailySummary[];
      } catch {
        return [] as DailySummary[];
      }
    },
    enabled: !!folderId,
  });

  const { data: monthSummariesRes } = useQuery({
    queryKey: ['folder-time-summary', folderId, monthStart],
    queryFn: async () => {
      try {
        const res = await api.get(
          `/pm/folders/${folderId}/time-summary?from=${monthStart}&to=${monthEnd}`,
        );
        return res.data.data as DailySummary[];
      } catch {
        return [] as DailySummary[];
      }
    },
    enabled: !!folderId,
  });

  const summaries = summariesRes || [];
  const monthSummaries = monthSummariesRes || [];
  const todayKey = toISODate(new Date());

  const days: HoursDay[] = WEEKDAY_LABELS.map((label, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const isWeekend = i >= 5;
    const iso = toISODate(d);
    const secs = summaries.find((s) => s.date === iso)?.total_work_seconds || 0;
    const used = secs / 3600;
    const allot = isWeekend ? 0 : dailyHours;
    const over = Math.max(0, used - allot);
    return {
      day: label,
      used: Math.min(used, allot),
      allot,
      over,
      today: iso === todayKey,
      weekend: isWeekend,
      future: d > new Date(),
    };
  });

  const usedToday = (summaries.find((s) => s.date === todayKey)?.total_work_seconds || 0) / 3600;
  const usedWeek = days.reduce((sum, d) => sum + d.used + d.over, 0);
  const usedMonth = monthSummaries.reduce((sum, s) => sum + s.total_work_seconds, 0) / 3600;

  return {
    name: 'Pro',
    dailyHours,
    weeklyHours,
    monthlyHours,
    usedToday: Math.round(usedToday * 10) / 10,
    usedWeek: Math.round(usedWeek * 10) / 10,
    usedMonth: Math.round(usedMonth * 10) / 10,
    days,
  };
}
