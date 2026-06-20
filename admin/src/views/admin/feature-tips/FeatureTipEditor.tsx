'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../../../services/api';
import {
  FeatureTipRow,
  TipAudience,
  TipStep,
  USER_TYPE_OPTIONS,
  WORKSPACE_ROLE_OPTIONS,
} from './types';
import FeatureTipPreview from './FeatureTipPreview';

const INPUT =
  'w-full rounded-md border border-divider-strong bg-surface px-3 py-2.5 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent';
const LABEL = 'mb-1.5 block text-xs font-medium text-foreground-muted';

interface NameRow {
  id: string;
  name?: string;
  display_name?: string;
  color?: string;
  email?: string;
}

export default function FeatureTipEditor({
  tip,
  onClose,
  onSaved,
}: {
  tip: FeatureTipRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const close = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const [title, setTitle] = useState(tip?.title ?? '');
  const [body, setBody] = useState(tip?.body ?? '');
  const [targetView, setTargetView] = useState(tip?.target_view ?? '');
  const [targetAnchor, setTargetAnchor] = useState(tip?.target_anchor ?? '');
  const [showPreview, setShowPreview] = useState(false);

  // A tip is either a single card (placement below) or a guided tour (ordered
  // steps). Title/body always label the tip; in tour mode they aren't shown to
  // users — the steps are.
  const [tourMode, setTourMode] = useState<boolean>((tip?.steps?.length ?? 0) > 0);
  const [steps, setSteps] = useState<TipStep[]>(tip?.steps ?? []);

  const switchToTour = () => {
    setTourMode(true);
    if (steps.length === 0) {
      // Seed the first step from any single-card placement already entered.
      setSteps([{ title: title.trim(), body: body.trim(), target_view: targetView || null, target_anchor: targetAnchor || null }]);
    }
  };
  const updateStep = (idx: number, patch: Partial<TipStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const addStep = () =>
    setSteps((prev) => [...prev, { title: '', body: '', target_view: null, target_anchor: null }]);
  const removeStep = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx));
  const moveStep = (idx: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const initialAudience = tip?.audience ?? {};
  const audienceEmpty =
    !initialAudience ||
    Object.values(initialAudience).every((v) => !v || (Array.isArray(v) && v.length === 0));
  const [allUsers, setAllUsers] = useState(audienceEmpty);
  const [userTypes, setUserTypes] = useState<string[]>(initialAudience.user_types ?? []);
  const [workspaceRoles, setWorkspaceRoles] = useState<string[]>(initialAudience.workspace_roles ?? []);
  const [roleIds, setRoleIds] = useState<string[]>(initialAudience.role_ids ?? []);
  const [departmentIds, setDepartmentIds] = useState<string[]>(initialAudience.department_ids ?? []);
  const [userIds, setUserIds] = useState<string[]>(initialAudience.user_ids ?? []);
  const [userSearch, setUserSearch] = useState('');

  // Catalogs + audience option sources.
  const { data: viewsRes } = useQuery({
    queryKey: ['admin-tip-target-views'],
    queryFn: () => api.get('/admin/feature-tips/target-views').then((r) => r.data),
  });
  const targetViews: { value: string; label: string }[] = viewsRes?.data || [];

  const { data: anchorsRes } = useQuery({
    queryKey: ['admin-tip-anchor-keys'],
    queryFn: () => api.get('/admin/feature-tips/anchor-keys').then((r) => r.data),
  });
  const anchorKeys: string[] = anchorsRes?.data || [];

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
    enabled: !allUsers,
  });
  const roles: NameRow[] = rolesRes?.data || [];

  const { data: deptRes } = useQuery({
    queryKey: ['admin-departments'],
    queryFn: () => api.get('/admin/departments').then((r) => r.data),
    enabled: !allUsers,
  });
  const departments: NameRow[] = deptRes?.data || [];

  // Server-side user search (the /admin/users list is capped at 100, so we can't
  // hold the whole org client-side). Debounce the query term.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(userSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [userSearch]);

  const { data: searchRes } = useQuery({
    queryKey: ['admin-tip-user-search', debouncedSearch],
    queryFn: () => api.get(`/admin/users?search=${encodeURIComponent(debouncedSearch)}&limit=20`).then((r) => r.data),
    enabled: !allUsers && debouncedSearch.length >= 2,
  });
  const searchResults: NameRow[] = searchRes?.data || [];

  // Seed names for already-selected users so chips show names, not raw ids.
  const { data: seedRes } = useQuery({
    queryKey: ['admin-tip-users-seed'],
    queryFn: () => api.get('/admin/users?limit=100').then((r) => r.data),
    enabled: !allUsers && userIds.length > 0,
  });

  // Accumulated id → user meta (from seed + search + explicit picks).
  const [userMeta, setUserMeta] = useState<Record<string, NameRow>>({});
  useEffect(() => {
    const rows: NameRow[] = [...(seedRes?.data || []), ...searchResults];
    if (!rows.length) return;
    setUserMeta((m) => {
      let changed = false;
      const next = { ...m };
      for (const u of rows) if (u?.id && !next[u.id]) { next[u.id] = u; changed = true; }
      return changed ? next : m;
    });
  }, [seedRes, searchRes]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedUserChips = useMemo(
    () => userIds.map((id) => userMeta[id] || { id, display_name: id.slice(0, 8) }),
    [userIds, userMeta],
  );
  const userResults = useMemo(
    () => searchResults.filter((u) => !userIds.includes(u.id)).slice(0, 8),
    [searchResults, userIds],
  );

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) =>
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  const buildAudience = (): TipAudience => {
    if (allUsers) return {};
    const a: TipAudience = {};
    if (userTypes.length) a.user_types = userTypes;
    if (workspaceRoles.length) a.workspace_roles = workspaceRoles;
    if (roleIds.length) a.role_ids = roleIds;
    if (departmentIds.length) a.department_ids = departmentIds;
    if (userIds.length) a.user_ids = userIds;
    return a;
  };

  const cleanSteps = (): TipStep[] =>
    steps.map((s) => ({
      title: s.title.trim(),
      body: s.body.trim(),
      target_view: s.target_view || null,
      target_anchor: s.target_anchor || null,
    }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        // Tour mode drives placement through steps, not the top-level fields.
        target_view: tourMode ? null : targetView || null,
        target_anchor: tourMode ? null : targetAnchor || null,
        steps: tourMode && steps.length > 0 ? cleanSteps() : null,
        audience: buildAudience(),
      };
      return tip
        ? api.put(`/admin/feature-tips/${tip.id}`, payload)
        : api.post('/admin/feature-tips', payload);
    },
    onSuccess: onSaved,
  });

  // Guard the ambiguous state: "all users" off + no filters serializes to {},
  // which the server would treat as everyone — block it so intent is explicit.
  const audienceChosen =
    allUsers || Object.values(buildAudience()).some((v) => Array.isArray(v) && v.length > 0);
  const stepsValid =
    !tourMode || (steps.length > 0 && steps.every((s) => s.title.trim().length > 0 && s.body.trim().length > 0));
  const canSave =
    title.trim().length > 0 && body.trim().length > 0 && audienceChosen && stepsValid && !save.isPending;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-divider bg-surface shadow-2xl transition-transform duration-200 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">
            {tip ? 'Edit tip' : 'New tip'}
          </h3>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div>
            <label className={LABEL}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={INPUT} placeholder="Introducing Squad Notes" />
          </div>
          <div>
            <label className={LABEL}>Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} className={INPUT} placeholder="What's new and why it matters…" />
          </div>

          <div className="rounded-lg border border-divider bg-canvas p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-foreground-dim">Placement</p>
              <div className="flex rounded-md border border-divider bg-surface p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setTourMode(false)}
                  className={`rounded px-2.5 py-1 transition ${!tourMode ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:text-foreground'}`}
                >
                  Single card
                </button>
                <button
                  type="button"
                  onClick={switchToTour}
                  className={`rounded px-2.5 py-1 transition ${tourMode ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:text-foreground'}`}
                >
                  Guided tour
                </button>
              </div>
            </div>

            {/* Shared anchor autocomplete for every placement field. */}
            <datalist id="tip-anchor-keys">
              {anchorKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>

            {!tourMode ? (
              <PlacementFields
                targetView={targetView}
                onTargetView={setTargetView}
                targetAnchor={targetAnchor}
                onTargetAnchor={setTargetAnchor}
                targetViews={targetViews}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-foreground-dim">
                  Users step through these in order (Back / Next). The title &amp; description above just label the
                  tour — they aren’t shown during it.
                </p>
                {steps.map((s, idx) => (
                  <StepCard
                    key={idx}
                    index={idx}
                    total={steps.length}
                    step={s}
                    targetViews={targetViews}
                    onChange={(patch) => updateStep(idx, patch)}
                    onRemove={() => removeStep(idx)}
                    onMove={(dir) => moveStep(idx, dir)}
                  />
                ))}
                {steps.length < 8 && (
                  <button
                    type="button"
                    onClick={addStep}
                    className="w-full rounded-md border border-dashed border-divider-strong py-2 text-xs font-medium text-foreground-muted transition hover:border-accent hover:text-foreground"
                  >
                    + Add step
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-divider bg-canvas p-3.5 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-foreground-dim">Audience</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={allUsers} onChange={(e) => setAllUsers(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              All active users
            </label>

            {!allUsers && (
              <div className="space-y-4 border-t border-divider pt-3">
                <ChipGroup
                  label="User types"
                  options={USER_TYPE_OPTIONS}
                  selected={userTypes}
                  onToggle={(v) => toggle(userTypes, setUserTypes, v)}
                />
                <ChipGroup
                  label="Workspace roles"
                  options={WORKSPACE_ROLE_OPTIONS}
                  selected={workspaceRoles}
                  onToggle={(v) => toggle(workspaceRoles, setWorkspaceRoles, v)}
                />
                <ChipGroup
                  label="Custom roles"
                  options={roles.map((r) => ({ value: r.id, label: r.name || r.id, color: r.color }))}
                  selected={roleIds}
                  onToggle={(v) => toggle(roleIds, setRoleIds, v)}
                />
                <ChipGroup
                  label="Departments"
                  options={departments.map((d) => ({ value: d.id, label: d.name || d.id, color: d.color }))}
                  selected={departmentIds}
                  onToggle={(v) => toggle(departmentIds, setDepartmentIds, v)}
                />

                <div>
                  <label className={LABEL}>Specific users</label>
                  {selectedUserChips.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {selectedUserChips.map((u) => (
                        <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 text-xs text-foreground">
                          {u.display_name || u.id}
                          <button onClick={() => setUserIds(userIds.filter((id) => id !== u.id))} className="text-foreground-dim hover:text-foreground">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className={INPUT}
                    placeholder="Search users by name or email…"
                  />
                  {userResults.length > 0 && (
                    <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-divider">
                      {userResults.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => { setUserIds([...userIds, u.id]); setUserMeta((m) => ({ ...m, [u.id]: u })); setUserSearch(''); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-alt"
                        >
                          <span className="text-foreground">{u.display_name || u.id}</span>
                          <span className="text-[11px] text-foreground-dim">{u.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-foreground-dim">
                  A user matching <em>any</em> selected filter is included. Pick at least one filter, or turn on
                  “All active users”.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-divider px-6 py-4">
          <button
            onClick={() => setShowPreview(true)}
            className="rounded-md border border-divider bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Preview
          </button>
          <div className="flex items-center gap-2">
            <button onClick={close} className="rounded-md border border-divider bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt">
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={!canSave}
              className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : tip ? 'Save changes' : 'Create tip'}
            </button>
          </div>
        </div>
      </div>

      {showPreview && (
        <FeatureTipPreview
          title={title}
          body={body}
          targetView={targetView || null}
          targetAnchor={targetAnchor || null}
          viewLabel={targetViews.find((v) => v.value === targetView)?.label}
          steps={tourMode && steps.length > 0 ? cleanSteps() : null}
          targetViews={targetViews}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
}

function PlacementFields({
  targetView,
  onTargetView,
  targetAnchor,
  onTargetAnchor,
  targetViews,
}: {
  targetView: string;
  onTargetView: (v: string) => void;
  targetAnchor: string;
  onTargetAnchor: (v: string) => void;
  targetViews: { value: string; label: string }[];
}) {
  return (
    <>
      <div>
        <label className={LABEL}>Guide to screen (optional)</label>
        <select value={targetView} onChange={(e) => onTargetView(e.target.value)} className={INPUT}>
          <option value="">No screen — show a centered card</option>
          {targetViews.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL}>Spotlight element (optional)</label>
        <input
          value={targetAnchor}
          onChange={(e) => onTargetAnchor(e.target.value)}
          list="tip-anchor-keys"
          className={INPUT}
          placeholder="e.g. rail.tasks"
        />
        <p className="mt-1 text-[11px] text-foreground-dim">
          Anchors a coachmark to that element. Leave both empty for a centered “What’s new” card.
        </p>
      </div>
    </>
  );
}

function StepCard({
  index,
  total,
  step,
  targetViews,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  step: TipStep;
  targetViews: { value: string; label: string }[];
  onChange: (patch: Partial<TipStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-2.5 rounded-md border border-divider bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">Step {index + 1}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Move up" className="rounded px-1.5 py-0.5 text-foreground-dim transition hover:bg-surface-alt hover:text-foreground disabled:opacity-30">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} title="Move down" className="rounded px-1.5 py-0.5 text-foreground-dim transition hover:bg-surface-alt hover:text-foreground disabled:opacity-30">↓</button>
          <button type="button" onClick={onRemove} title="Remove step" className="rounded px-1.5 py-0.5 text-foreground-dim transition hover:bg-surface-alt hover:text-red-500">✕</button>
        </div>
      </div>
      <input value={step.title} onChange={(e) => onChange({ title: e.target.value })} maxLength={120} className={INPUT} placeholder="Step title" />
      <textarea value={step.body} onChange={(e) => onChange({ body: e.target.value })} rows={2} maxLength={2000} className={INPUT} placeholder="What to point out…" />
      <div className="grid grid-cols-2 gap-2">
        <select value={step.target_view ?? ''} onChange={(e) => onChange({ target_view: e.target.value || null })} className={INPUT}>
          <option value="">No screen</option>
          {targetViews.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
        <input value={step.target_anchor ?? ''} onChange={(e) => onChange({ target_anchor: e.target.value || null })} list="tip-anchor-keys" className={INPUT} placeholder="Spotlight (e.g. rail.apps)" />
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string; color?: string }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                on
                  ? 'border-accent bg-surface-alt text-foreground'
                  : 'border-divider bg-surface text-foreground-muted hover:border-divider-strong hover:text-foreground'
              }`}
            >
              {o.color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: o.color }} />}
              {o.label}
              {on && <span className="text-accent">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
