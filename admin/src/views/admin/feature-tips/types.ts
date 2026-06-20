// Shared shapes for the admin Feature Tips views.
export interface TipAudience {
  user_types?: string[];
  workspace_roles?: string[];
  role_ids?: string[];
  department_ids?: string[];
  user_ids?: string[];
}

// One step of a guided tour (same placement shape as a single-card tip).
export interface TipStep {
  title: string;
  body: string;
  target_view: string | null;
  target_anchor: string | null;
}

export interface FeatureTipRow {
  id: string;
  title: string;
  body: string;
  target_view: string | null;
  target_anchor: string | null;
  /** Ordered steps for a guided tour; null/empty ⇒ single card. */
  steps?: TipStep[] | null;
  audience: TipAudience;
  is_active: boolean;
  current_revision: number;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  accepted_count?: number;
}

export interface RosterRow {
  user: { id: string; display_name: string; email: string; avatar_url: string | null };
  status: 'accepted' | 'snoozed' | 'pending';
  accepted_at: string | null;
  dismissed_until: string | null;
}

export interface RosterData {
  revision: number;
  current_revision: number;
  available_revisions: number[];
  counts: { accepted: number; snoozed: number; pending: number; total: number };
  rows: RosterRow[];
}

export const USER_TYPE_OPTIONS = [
  { value: 'internal', label: 'Internal' },
  { value: 'client', label: 'Client' },
  { value: 'client_staff', label: 'Client Staff' },
  { value: 'partner', label: 'Partner' },
  { value: 'partner_employee', label: 'Partner Employee' },
];

export const WORKSPACE_ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];

// Short human summary of a tip's audience for the table.
export function audienceSummary(a: TipAudience | null | undefined): string {
  if (!a) return 'All users';
  const parts: string[] = [];
  if (a.user_types?.length) parts.push(`${a.user_types.length} type${a.user_types.length > 1 ? 's' : ''}`);
  if (a.workspace_roles?.length) parts.push(`${a.workspace_roles.length} ws-role${a.workspace_roles.length > 1 ? 's' : ''}`);
  if (a.role_ids?.length) parts.push(`${a.role_ids.length} role${a.role_ids.length > 1 ? 's' : ''}`);
  if (a.department_ids?.length) parts.push(`${a.department_ids.length} dept${a.department_ids.length > 1 ? 's' : ''}`);
  if (a.user_ids?.length) parts.push(`${a.user_ids.length} user${a.user_ids.length > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : 'All users';
}
