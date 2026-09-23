'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import {
  LMS_SHARE_USER_TYPES,
  type Role,
  type User,
  type SkillDef,
  type SkillGrant,
  type SkillPrincipalType,
} from '@squadhub/shared';

type SkillWithGrants = SkillDef & { grants: SkillGrant[] };

const PRINCIPAL_LABEL: Record<SkillPrincipalType, string> = {
  user: 'People',
  role: 'Roles',
  user_type: 'User types',
};

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

/**
 * Skills: capabilities defined in code, granted here at a level to specific
 * people, roles, or whole user types. Someone's effective level is the highest
 * grant that matches them; platform admins always hold the top level.
 */
export default function AdminSkills() {
  const { data: skills, isLoading, error } = useQuery<SkillWithGrants[]>({
    queryKey: ['admin-skills'],
    queryFn: async () => (await api.get('/admin/skills')).data.data,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Skills</h1>
        <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
          Give specific people, roles, or user types extra abilities. When someone matches more than one
          grant, the highest level wins. Admins always have every skill at its highest level.
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-red-500">{errorMessage(error, 'Could not load skills')}</p>
      ) : (
        <div className="space-y-6">
          {(skills || []).map((skill) => <SkillCard key={skill.key} skill={skill} />)}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillWithGrants }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-skills'] });

  const upsert = useMutation({
    mutationFn: (body: { principal_type: SkillPrincipalType; principal_id: string; level: string }) =>
      api.put(`/admin/skills/${skill.key}/grants`, body),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e) => setErr(errorMessage(e, 'Could not save that grant')),
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => api.delete(`/admin/skills/${skill.key}/grants/${grantId}`),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e) => setErr(errorMessage(e, 'Could not remove that grant')),
  });

  const byType = (t: SkillPrincipalType) => skill.grants.filter((g) => g.principal_type === t);

  return (
    <section className="rounded-xl border border-divider bg-surface">
      <header className="border-b border-divider px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">{skill.name}</h2>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">
            {skill.category}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-foreground-muted">{skill.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {skill.levels.map((l) => (
            <div key={l.value} className="rounded-lg border border-divider bg-surface-alt px-3 py-2">
              <p className="text-xs font-semibold text-foreground">{l.label}</p>
              <p className="mt-0.5 text-xs text-foreground-dim">{l.description}</p>
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-divider px-3 py-2">
            <p className="text-xs font-semibold text-foreground-muted">No skill</p>
            <p className="mt-0.5 text-xs text-foreground-dim">Can only add time, never change what is logged.</p>
          </div>
        </div>
      </header>

      <div className="px-5 py-4">
        <GrantForm
          skill={skill}
          existing={skill.grants}
          pending={upsert.isPending}
          onGrant={(principal_type, principal_id, level) => upsert.mutate({ principal_type, principal_id, level })}
        />
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}

        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {(['user', 'role', 'user_type'] as SkillPrincipalType[]).map((t) => (
            <div key={t}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-dim">
                {PRINCIPAL_LABEL[t]} ({byType(t).length})
              </p>
              {byType(t).length === 0 ? (
                <p className="text-xs text-foreground-dim">None yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {byType(t).map((g) => (
                    <GrantRow
                      key={g.id}
                      grant={g}
                      skill={skill}
                      onLevel={(level) => upsert.mutate({ principal_type: g.principal_type, principal_id: g.principal_id, level })}
                      onRemove={() => revoke.mutate(g.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function principalName(g: SkillGrant): { name: string; sub?: string; color?: string } {
  if (g.principal_type === 'user') {
    return { name: g.user?.display_name || g.user?.email || 'Unknown user', sub: g.user?.email || undefined };
  }
  if (g.principal_type === 'role') {
    return { name: g.role?.name || 'Unknown role', color: g.role?.color || '#90A1B9' };
  }
  const t = LMS_SHARE_USER_TYPES.find((x) => x.value === g.principal_id);
  return { name: t?.label || g.principal_id, sub: t?.description, color: t?.color };
}

function GrantRow({
  grant, skill, onLevel, onRemove,
}: {
  grant: SkillGrant;
  skill: SkillDef;
  onLevel: (level: string) => void;
  onRemove: () => void;
}) {
  const p = principalName(grant);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-divider px-3 py-2">
      {p.color && <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{p.name}</p>
        {p.sub && <p className="truncate text-[11px] text-foreground-dim">{p.sub}</p>}
      </div>
      <select
        value={grant.level}
        onChange={(e) => onLevel(e.target.value)}
        className="rounded-md border border-divider bg-surface px-1.5 py-1 text-xs text-foreground focus:border-ink focus:outline-none"
        aria-label={`Level for ${p.name}`}
      >
        {skill.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700" aria-label={`Remove ${p.name}`}>
        Remove
      </button>
    </div>
  );
}

function GrantForm({
  skill, existing, pending, onGrant,
}: {
  skill: SkillDef;
  existing: SkillGrant[];
  pending: boolean;
  onGrant: (type: SkillPrincipalType, id: string, level: string) => void;
}) {
  const [type, setType] = useState<SkillPrincipalType>('user');
  const [principalId, setPrincipalId] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState(skill.levels[0].value);

  const { data: users } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => (await api.get('/admin/users')).data.data,
    enabled: type === 'user',
  });
  const { data: roles } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => (await api.get('/admin/roles')).data.data,
    enabled: type === 'role',
  });

  const taken = useMemo(
    () => new Set(existing.filter((g) => g.principal_type === type).map((g) => g.principal_id)),
    [existing, type],
  );

  const matchingUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users || [])
      .filter((u) => !taken.has(u.id))
      .filter((u) => !q || u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [users, taken, search]);

  const chosenUser = type === 'user' ? (users || []).find((u) => u.id === principalId) : undefined;

  const submit = () => {
    if (!principalId) return;
    onGrant(type, principalId, level);
    setPrincipalId('');
    setSearch('');
  };

  return (
    <div className="rounded-lg border border-divider bg-surface-alt p-3">
      <p className="mb-2 text-xs font-semibold text-foreground">Give this skill to…</p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex rounded-lg border border-divider bg-surface p-0.5">
          {(['user', 'role', 'user_type'] as SkillPrincipalType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setPrincipalId(''); setSearch(''); }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                type === t ? 'bg-ink text-white' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {t === 'user' ? 'A person' : t === 'role' ? 'A role' : 'A user type'}
            </button>
          ))}
        </div>

        {type === 'user' && (
          <div className="relative w-64">
            <input
              value={chosenUser ? (chosenUser.display_name || chosenUser.email) : search}
              onChange={(e) => { setSearch(e.target.value); setPrincipalId(''); }}
              placeholder="Search people…"
              className="w-full rounded-lg border border-divider bg-surface px-3 py-1.5 text-sm focus:border-ink focus:outline-none"
            />
            {!principalId && search.trim() && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-divider bg-surface shadow-lg">
                {matchingUsers.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-foreground-dim">No matches.</p>
                ) : matchingUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setPrincipalId(u.id); setSearch(''); }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-canvas"
                  >
                    <span className="block text-sm text-foreground">{u.display_name || u.email}</span>
                    <span className="block text-[11px] text-foreground-dim">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {type === 'role' && (
          <select
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            className="w-64 rounded-lg border border-divider bg-surface px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            <option value="">Choose a role…</option>
            {(roles || []).filter((r) => !taken.has(r.id)).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}

        {type === 'user_type' && (
          <select
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            className="w-64 rounded-lg border border-divider bg-surface px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          >
            <option value="">Choose a user type…</option>
            {LMS_SHARE_USER_TYPES.filter((t) => !taken.has(t.value)).map((t) => (
              <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
            ))}
          </select>
        )}

        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-lg border border-divider bg-surface px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          aria-label="Level"
        >
          {skill.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>

        <button
          type="button"
          onClick={submit}
          disabled={!principalId || pending}
          className="rounded-lg bg-ink px-4 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Grant'}
        </button>
      </div>
    </div>
  );
}
