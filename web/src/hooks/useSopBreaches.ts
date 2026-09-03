import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { SopEnforcementRule, SopFlag, SopStrike } from '@squadhub/shared';

export function useSopRules(itemId: string | null) {
  return useQuery<SopEnforcementRule[]>({
    queryKey: ['sop-rules', itemId],
    queryFn: async () => {
      const res = await api.get(`/sop-breaches/rules?item_id=${itemId}`);
      return res.data.data;
    },
    enabled: !!itemId,
  });
}

export function useAllSopRules() {
  return useQuery<SopEnforcementRule[]>({
    queryKey: ['sop-all-rules'],
    queryFn: async () => {
      const res = await api.get('/sop-breaches/all-rules');
      return res.data.data;
    },
    staleTime: 30_000,
  });
}

export function useUpsertSopRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<SopEnforcementRule> & { item_id: string }) => {
      const res = await api.put('/sop-breaches/rules', body);
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['sop-rules', vars.item_id] });
      qc.invalidateQueries({ queryKey: ['sop-all-rules'] });
    },
  });
}

export function useDeleteSopRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sop-breaches/rules/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sop-rules'] });
      qc.invalidateQueries({ queryKey: ['sop-all-rules'] });
    },
  });
}

export function useMyFlags() {
  return useQuery<SopFlag[]>({
    queryKey: ['my-sop-flags'],
    queryFn: async () => {
      const res = await api.get('/sop-breaches/my-flags');
      return res.data.data;
    },
  });
}

export function useMyStrikes() {
  return useQuery<SopStrike[]>({
    queryKey: ['my-sop-strikes'],
    queryFn: async () => {
      const res = await api.get('/sop-breaches/my-strikes');
      return res.data.data;
    },
  });
}

export function useReportBreach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { rule_id: string; user_id: string; reason?: string; source_kind?: string; source_id?: string }) => {
      const res = await api.post('/sop-breaches/report', body);
      return res.data.data as {
        flag: SopFlag;
        strike: SopStrike | null;
        count_in_window: number;
        threshold: number;
        is_strike: boolean;
        window_label: string;
        severity: string;
        strike_points: number;
        sop_link: string;
        sop_label: string;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-sop-flags'] });
      qc.invalidateQueries({ queryKey: ['my-sop-strikes'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// Admin
export function useAdminFlags(userId?: string) {
  return useQuery<SopFlag[]>({
    queryKey: ['admin-sop-flags', userId],
    queryFn: async () => {
      const qs = userId ? `?user_id=${userId}` : '';
      const res = await api.get(`/sop-breaches/admin/flags${qs}`);
      return res.data.data;
    },
  });
}

export function useAdminStrikes(userId?: string) {
  return useQuery<SopStrike[]>({
    queryKey: ['admin-sop-strikes', userId],
    queryFn: async () => {
      const qs = userId ? `?user_id=${userId}` : '';
      const res = await api.get(`/sop-breaches/admin/strikes${qs}`);
      return res.data.data;
    },
  });
}

export function useAdminSummary() {
  return useQuery<any[]>({
    queryKey: ['admin-sop-summary'],
    queryFn: async () => {
      const res = await api.get('/sop-breaches/admin/summary');
      return res.data.data;
    },
  });
}
