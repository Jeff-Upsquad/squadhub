import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { TimesheetProgressLine } from '@squadhub/shared';

export function useTimesheetToday(date?: string) {
  return useQuery({
    queryKey: ['timesheet-today', date || 'today'],
    queryFn: () =>
      api.get('/timesheet/today', { params: date ? { date } : {} }).then((r) => r.data),
    refetchInterval: 60000,
  });
}

export function useMissingTimesheets() {
  return useQuery({
    queryKey: ['timesheet-missing'],
    queryFn: () => api.get('/timesheet/missing').then((r) => r.data),
  });
}

export function useTimesheetDashboard(view: string) {
  return useQuery({
    queryKey: ['timesheet-dashboard', view],
    queryFn: () => api.get('/timesheet/dashboard', { params: { view } }).then((r) => r.data),
  });
}

interface SubmitArgs {
  date: string;
  summary: string;
  progress: TimesheetProgressLine[];
  completed_task_ids: string[];
}

export function useSubmitTimesheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitArgs) => api.post('/timesheet/submit', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet-today'] });
      qc.invalidateQueries({ queryKey: ['timesheet-missing'] });
      qc.invalidateQueries({ queryKey: ['timesheet-dashboard'] });
    },
  });
}
