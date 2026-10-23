import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

/*
 * Data layer for the super-admin "SaaS Accounts" module. Everything is served
 * by /admin/saas/* (server/src/routes/saas-accounts-admin.ts), which proxies the
 * Squad Hub SaaS bridge. Shapes below follow the bridge contract; optional
 * fields are read defensively because the SaaS side is built in parallel.
 */

export type SaasAccountKind = 'business' | 'talent' | 'shared';
export type SaasAccountStatus = 'active' | 'suspended' | string;

export interface SaasUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  hub_user_id?: string | null;
  is_owner?: boolean;
  is_staff?: boolean;
  joined_at?: string | null;
}

export interface SaasPlan {
  id: string;
  name: string;
  price_inr: number;
  free_staff_seats: number;
  is_default: boolean;
}

export interface SaasSharedWorkspace {
  id: string;
  name?: string | null;
  card_category?: string | null;
  hub_card_id?: string | null;
  status?: string | null;
  member_count?: number | null;
}

export interface SaasAccountMiniApp {
  slug: string;
  enabled: boolean;
  name?: string;
}

export interface SaasAccount {
  id: string;
  name?: string | null;
  kind: SaasAccountKind;
  status: SaasAccountStatus;
  plan?: Pick<SaasPlan, 'id' | 'name'> | null;
  plan_id?: string | null;
  plan_name?: string | null;
  seats_used?: number | null;
  seat_limit?: number | null;
  owner?: SaasUser | null;
  members?: SaasUser[];
  shared_workspaces?: SaasSharedWorkspace[];
  mini_apps?: Array<SaasAccountMiniApp | string>;
  hub_client_id?: string | null;
  hub_partner_user_id?: string | null;
  squadhire_business_id?: string | null;
  squadhire_talent_id?: string | null;
  created_at?: string | null;
}

export interface SaasMiniAppCatalogItem {
  slug: string;
  name?: string;
  description?: string | null;
}

export interface SaasAuditEntry {
  id: string;
  action: string;
  created_at: string;
  actor?: { hub_user_id?: string | null; email?: string | null; name?: string | null } | null;
  actor_email?: string | null;
  target?: string | null;
  reason?: string | null;
  details?: unknown;
}

export interface SaasCheckin {
  id: string;
  date?: string;
  created_at?: string;
  hub_partner_user_id?: string | null;
  user_name?: string | null;
  status?: string | null;
  mood?: string | null;
  note?: string | null;
}

export interface Paged<T> {
  items: T[];
  total?: number;
  page?: number;
  page_size?: number;
}

/** Mini apps on by default for talent accounts (contract). Cashbook is never offered. */
export const TALENT_DEFAULT_MINI_APPS = ['check-ins', 'partner-payments'];
export const HIDDEN_MINI_APPS = new Set(['cashbook']);

// ── helpers ─────────────────────────────────────────────────────────────────

export function isSaasNotConnected(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { code?: string } } } | null;
  return e?.response?.status === 503 && e.response.data?.code === 'saas_not_connected';
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string } | null;
  return e?.response?.data?.error || e?.message || fallback;
}

function toPaged<T>(data: unknown): Paged<T> {
  if (Array.isArray(data)) return { items: data as T[] };
  const d = (data || {}) as Record<string, unknown>;
  const items = (d.items || d.accounts || d.entries || d.rows || []) as T[];
  return {
    items: Array.isArray(items) ? items : [],
    total: typeof d.total === 'number' ? d.total : undefined,
    page: typeof d.page === 'number' ? d.page : undefined,
    page_size: typeof d.page_size === 'number' ? d.page_size : undefined,
  };
}

export function planNameOf(a: SaasAccount): string | null {
  return a.plan?.name || a.plan_name || null;
}

export function planIdOf(a: SaasAccount): string | null {
  return a.plan?.id || a.plan_id || null;
}

export function formatInr(n: number): string {
  if (!n) return 'Free';
  return `₹${n.toLocaleString('en-IN')}`;
}

/** Enabled state per slug, applying the talent defaults when the account carries no explicit row. */
export function miniAppStates(account: SaasAccount): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (account.kind === 'talent') TALENT_DEFAULT_MINI_APPS.forEach((s) => map.set(s, true));
  for (const m of account.mini_apps || []) {
    if (typeof m === 'string') map.set(m, true);
    else if (m && m.slug) map.set(m.slug, !!m.enabled);
  }
  return map;
}

// ── queries ─────────────────────────────────────────────────────────────────

const KEY = 'admin-saas';

export function useSaasStatus() {
  return useQuery({
    queryKey: [KEY, 'status'],
    queryFn: async () => (await api.get('/admin/saas/status')).data.data as { connected: boolean },
    staleTime: 60_000,
  });
}

export function useSaasAccounts(params: { q?: string; kind?: string; status?: string; page?: number }, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'accounts', params],
    queryFn: async () => {
      const res = await api.get('/admin/saas/accounts', {
        params: {
          q: params.q || undefined,
          kind: params.kind || undefined,
          status: params.status || undefined,
          page: params.page && params.page > 1 ? params.page : undefined,
        },
      });
      return toPaged<SaasAccount>(res.data.data);
    },
    enabled,
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
    placeholderData: (prev) => prev,
  });
}

export function useSaasAccount(id: string) {
  return useQuery({
    queryKey: [KEY, 'account', id],
    queryFn: async () => (await api.get(`/admin/saas/accounts/${encodeURIComponent(id)}`)).data.data as SaasAccount,
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
  });
}

export function useSaasPlans(enabled = true) {
  return useQuery({
    queryKey: [KEY, 'plans'],
    queryFn: async () => {
      const data = (await api.get('/admin/saas/plans')).data.data;
      return toPaged<SaasPlan>(data).items;
    },
    enabled,
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
  });
}

export function useSaasMiniAppCatalog(enabled = true) {
  return useQuery({
    queryKey: [KEY, 'mini-apps'],
    queryFn: async () => {
      const data = (await api.get('/admin/saas/mini-apps')).data.data;
      return toPaged<SaasMiniAppCatalogItem>(data).items.filter((a) => !HIDDEN_MINI_APPS.has(a.slug));
    },
    enabled,
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
  });
}

export function useSaasAudit(accountId: string) {
  return useQuery({
    queryKey: [KEY, 'audit', accountId],
    queryFn: async () => {
      const data = (await api.get('/admin/saas/audit', { params: { account_id: accountId } })).data.data;
      return toPaged<SaasAuditEntry>(data).items;
    },
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
  });
}

export function useSaasCheckins(hubPartnerUserId: string | null | undefined, from: string, to: string) {
  return useQuery({
    queryKey: [KEY, 'checkins', hubPartnerUserId, from, to],
    queryFn: async () => {
      const data = (
        await api.get('/admin/saas/checkins', { params: { hub_partner_user_id: hubPartnerUserId, from, to } })
      ).data.data;
      return toPaged<SaasCheckin>(data).items;
    },
    enabled: !!hubPartnerUserId,
    retry: (count, err) => !isSaasNotConnected(err) && count < 1,
  });
}

// ── mutations ───────────────────────────────────────────────────────────────

/** Account-scoped mutation that refreshes the account, its audit trail and the list. */
export function useAccountMutation<V>(accountId: string, fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'account', accountId] });
      qc.invalidateQueries({ queryKey: [KEY, 'audit', accountId] });
      qc.invalidateQueries({ queryKey: [KEY, 'accounts'] });
    },
  });
}

export const saasActions = {
  suspend: (id: string, reason?: string) => api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/suspend`, { reason }),
  reactivate: (id: string) => api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/reactivate`, {}),
  changeOwner: (id: string, userId: string) =>
    api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/owner`, { user_id: userId }),
  removeMember: (id: string, userId: string) =>
    api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/remove`, {}),
  assignPlan: (id: string, planId: string) =>
    api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/plan`, { plan_id: planId }),
  toggleMiniApp: (id: string, slug: string, enabled: boolean) =>
    api.post(`/admin/saas/accounts/${encodeURIComponent(id)}/mini-apps`, { slug, enabled }),
  impersonate: async (userId: string, reason: string): Promise<string | null> => {
    const data = (await api.post('/admin/saas/impersonate', { user_id: userId, reason })).data.data;
    if (typeof data === 'string') return data;
    return (data?.url || data?.login_url || null) as string | null;
  },
  createPlan: (plan: Omit<SaasPlan, 'id'>) => api.post('/admin/saas/plans', plan),
  updatePlan: (id: string, plan: Partial<Omit<SaasPlan, 'id'>>) =>
    api.put(`/admin/saas/plans/${encodeURIComponent(id)}`, plan),
};
