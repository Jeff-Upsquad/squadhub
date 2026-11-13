'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ConfirmDialog from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import SaasShell, { KindBadge, SaasError, SaasNotConnected, SeatUsage, StatusBadge } from './SaasShell';
import { squadhireLinkFor } from './SaasAccountsList';
import {
  errorMessage,
  formatInr,
  isSaasNotConnected,
  miniAppStates,
  planIdOf,
  planNameOf,
  saasActions,
  useAccountMutation,
  useSaasAccount,
  useSaasAudit,
  useSaasCheckins,
  useSaasMiniAppCatalog,
  useSaasPlans,
  type SaasUser,
} from './saasApi';

const CARD = 'rounded-lg border border-divider bg-surface';
const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-foreground-dim';
const BTN = 'rounded-lg border border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50';
const BTN_PRIMARY = 'rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50';
const INPUT = 'mt-1 w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:outline-none';

function fmtDateTime(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function SaasAccountDetail({ accountId }: { accountId: string }) {
  const { data: account, isLoading, error, refetch } = useSaasAccount(accountId);
  const connected = !error || !isSaasNotConnected(error);
  const { data: plans } = useSaasPlans(connected);
  const { data: catalog } = useSaasMiniAppCatalog(connected);
  const { adminUrl } = useSquadhireConfig();

  const [selectedPlan, setSelectedPlan] = useState('');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<SaasUser | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<SaasUser | null>(null);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [impersonateError, setImpersonateError] = useState('');

  useEffect(() => {
    if (account) setSelectedPlan(planIdOf(account) || '');
  }, [account]);

  const onFail = (fallback: string) => (err: unknown) => showToast(errorMessage(err, fallback), 'error');

  const suspend = useAccountMutation(accountId, (reason: string) => saasActions.suspend(accountId, reason || undefined));
  const reactivate = useAccountMutation(accountId, () => saasActions.reactivate(accountId));
  const changeOwner = useAccountMutation(accountId, (userId: string) => saasActions.changeOwner(accountId, userId));
  const removeMember = useAccountMutation(accountId, (userId: string) => saasActions.removeMember(accountId, userId));
  const assignPlan = useAccountMutation(accountId, (planId: string) => saasActions.assignPlan(accountId, planId));
  const toggleApp = useAccountMutation(accountId, (v: { slug: string; enabled: boolean }) =>
    saasActions.toggleMiniApp(accountId, v.slug, v.enabled),
  );
  const impersonate = useAccountMutation(accountId, (v: { userId: string; reason: string }) =>
    saasActions.impersonate(v.userId, v.reason),
  );

  const members = useMemo(() => {
    const list = [...(account?.members || [])];
    const owner = account?.owner;
    if (owner && !list.some((m) => m.id === owner.id)) list.unshift({ ...owner, is_owner: true });
    return list.map((m) => ({ ...m, is_owner: m.is_owner || m.id === owner?.id }));
  }, [account]);

  const appStates = account ? miniAppStates(account) : new Map<string, boolean>();

  if (error && isSaasNotConnected(error)) {
    return (
      <SaasShell title="SaaS Account">
        <SaasNotConnected />
      </SaasShell>
    );
  }

  const back = (
    <Link href="/admin/saas-accounts" className="text-xs font-medium text-foreground-muted hover:text-foreground">
      ← All accounts
    </Link>
  );

  if (isLoading || (!account && !error)) {
    return (
      <SaasShell title="SaaS Account" actions={back}>
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      </SaasShell>
    );
  }

  if (error || !account) {
    return (
      <SaasShell title="SaaS Account" actions={back}>
        <SaasError message={errorMessage(error, 'Could not load this account')} onRetry={() => refetch()} />
      </SaasShell>
    );
  }

  const suspended = account.status !== 'active';
  const shLink = squadhireLinkFor(account, adminUrl);
  const currentPlanId = planIdOf(account) || '';

  const startImpersonation = () => {
    if (!impersonateTarget) return;
    const reason = impersonateReason.trim();
    if (reason.length < 5) {
      setImpersonateError('Please give a reason (at least 5 characters).');
      return;
    }
    // Open the tab inside the click so popup blockers allow it; point it at the
    // one-time URL once the bridge answers.
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    impersonate.mutate(
      { userId: impersonateTarget.id, reason },
      {
        onSuccess: (url) => {
          const target = typeof url === 'string' ? url : null;
          if (!target) {
            win?.close();
            showToast('SaaS did not return a login link', 'error');
            return;
          }
          if (win) win.location.href = target;
          else window.open(target, '_blank', 'noopener,noreferrer');
          showToast(`Logged in as ${impersonateTarget.name || impersonateTarget.email} in a new tab`, 'success');
          setImpersonateTarget(null);
          setImpersonateReason('');
          setImpersonateError('');
        },
        onError: (err) => {
          win?.close();
          setImpersonateError(errorMessage(err, 'Could not start the session'));
        },
      },
    );
  };

  return (
    <SaasShell
      title={account.name || 'Untitled account'}
      subtitle={`SaaS account ${account.id}`}
      actions={
        <div className="flex items-center gap-2">
          {back}
          {suspended ? (
            <button onClick={() => setReactivateOpen(true)} className={BTN_PRIMARY}>Reactivate</button>
          ) : (
            <button onClick={() => setSuspendOpen(true)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30">
              Suspend
            </button>
          )}
        </div>
      }
    >
      {/* Summary */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <KindBadge kind={account.kind} />
        <StatusBadge status={account.status} />
        {account.created_at && <span className="text-xs text-foreground-dim">Created {fmtDateTime(account.created_at)}</span>}
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <p className={SECTION_TITLE}>Owner</p>
            {members.length > 1 && (
              <button onClick={() => { setNewOwnerId(''); setOwnerOpen(true); }} className="text-xs font-medium text-accent hover:underline">
                Change
              </button>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">{account.owner?.name || account.owner?.email || '—'}</p>
          {account.owner?.name && account.owner.email && <p className="text-xs text-foreground-dim">{account.owner.email}</p>}
        </div>

        <div className={`${CARD} p-4`}>
          <p className={SECTION_TITLE}>Plan</p>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-divider bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none"
            >
              {!currentPlanId && <option value="">{planNameOf(account) || 'No plan'}</option>}
              {(plans || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatInr(p.price_inr)} · {p.free_staff_seats} free seats{p.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button
              disabled={!selectedPlan || selectedPlan === currentPlanId || assignPlan.isPending}
              onClick={() =>
                assignPlan.mutate(selectedPlan, {
                  onSuccess: () => showToast('Plan updated', 'success'),
                  onError: onFail('Could not change plan'),
                })
              }
              className={BTN_PRIMARY}
            >
              {assignPlan.isPending ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <p className={SECTION_TITLE}>Seats</p>
          <div className="mt-2"><SeatUsage used={account.seats_used} limit={account.seat_limit} /></div>
          <div className="mt-3 space-y-0.5 text-xs text-foreground-dim">
            {shLink ? (
              <a href={shLink} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">Open in SquadHire ↗</a>
            ) : (account.squadhire_talent_id || account.squadhire_business_id) ? (
              <p>SquadHire: {account.squadhire_talent_id || account.squadhire_business_id}</p>
            ) : null}
            {account.hub_client_id && <p>Hub client: {account.hub_client_id}</p>}
            {account.hub_partner_user_id && <p>Hub partner: {account.hub_partner_user_id}</p>}
          </div>
        </div>
      </div>

      {/* Members */}
      <section className={`${CARD} mb-5`}>
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <p className={SECTION_TITLE}>Members ({members.length})</p>
          <p className="text-[11px] text-foreground-dim">&ldquo;Log in as&rdquo; is audited on the SaaS</p>
        </div>
        {members.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-foreground-dim">No members.</p>
        ) : (
          <ul>
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{m.name || m.email || m.id}</span>
                    {m.is_owner && <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">Owner</span>}
                    {m.is_staff && <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">Upsquad staff</span>}
                    {m.role && <span className="text-[11px] capitalize text-foreground-dim">{m.role}</span>}
                  </div>
                  {m.name && m.email && <p className="truncate text-xs text-foreground-dim">{m.email}</p>}
                </div>
                <button
                  onClick={() => { setImpersonateTarget(m); setImpersonateReason(''); setImpersonateError(''); }}
                  className={BTN}
                  disabled={suspended}
                  title={suspended ? 'Reactivate the account to log in as its members' : undefined}
                >
                  Log in as
                </button>
                {!m.is_owner && (
                  <button onClick={() => setRemoveTarget(m)} className="rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-5 grid gap-4 md:grid-cols-2">
        {/* Shared workspaces */}
        <section className={CARD}>
          <div className="border-b border-divider px-4 py-3">
            <p className={SECTION_TITLE}>Shared workspaces ({account.shared_workspaces?.length || 0})</p>
          </div>
          {!account.shared_workspaces?.length ? (
            <p className="px-4 py-6 text-center text-sm text-foreground-dim">No shared workspaces.</p>
          ) : (
            <ul>
              {account.shared_workspaces.map((w) => (
                <li key={w.id} className="flex items-center gap-3 border-b border-divider px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{w.name || w.id}</p>
                    <p className="text-xs text-foreground-dim">
                      {[w.card_category, w.member_count != null ? `${w.member_count} members` : null].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {w.status && <StatusBadge status={w.status} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Mini apps */}
        <section className={CARD}>
          <div className="border-b border-divider px-4 py-3">
            <p className={SECTION_TITLE}>Mini apps</p>
          </div>
          {!catalog ? (
            <p className="px-4 py-6 text-center text-sm text-foreground-dim">Loading...</p>
          ) : catalog.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-foreground-dim">No mini apps in the SaaS catalog.</p>
          ) : (
            <ul>
              {catalog.map((app) => {
                const on = appStates.get(app.slug) ?? false;
                const pending = toggleApp.isPending && toggleApp.variables?.slug === app.slug;
                return (
                  <li key={app.slug} className="flex items-center gap-3 border-b border-divider px-4 py-2.5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{app.name || app.slug}</p>
                      {app.description && <p className="truncate text-xs text-foreground-dim">{app.description}</p>}
                    </div>
                    <button
                      role="switch"
                      aria-checked={on}
                      aria-label={`${on ? 'Disable' : 'Enable'} ${app.name || app.slug}`}
                      disabled={pending}
                      onClick={() =>
                        toggleApp.mutate(
                          { slug: app.slug, enabled: !on },
                          { onError: onFail('Could not update mini app') },
                        )
                      }
                      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-divider-strong'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {account.kind === 'talent' && account.hub_partner_user_id && (
        <TalentCheckins hubPartnerUserId={account.hub_partner_user_id} />
      )}

      <AuditTrail accountId={accountId} />

      {/* ── Dialogs ── */}
      <ConfirmDialog
        open={suspendOpen}
        title="Suspend this account?"
        description="Members lose access to the SaaS until it is reactivated. Data is kept."
        confirmLabel="Suspend"
        variant="danger"
        isPending={suspend.isPending}
        pendingLabel="Suspending…"
        onCancel={() => setSuspendOpen(false)}
        onConfirm={() =>
          suspend.mutate(suspendReason.trim(), {
            onSuccess: () => { setSuspendOpen(false); setSuspendReason(''); showToast('Account suspended', 'success'); },
            onError: onFail('Could not suspend'),
          })
        }
      >
        <label className="mt-3 block text-xs font-medium text-foreground-muted">
          Reason (optional, recorded in the audit log)
          <input value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} className={INPUT} />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={reactivateOpen}
        title="Reactivate this account?"
        description="Members regain access immediately."
        confirmLabel="Reactivate"
        isPending={reactivate.isPending}
        pendingLabel="Reactivating…"
        onCancel={() => setReactivateOpen(false)}
        onConfirm={() =>
          reactivate.mutate(undefined, {
            onSuccess: () => { setReactivateOpen(false); showToast('Account reactivated', 'success'); },
            onError: onFail('Could not reactivate'),
          })
        }
      />

      <ConfirmDialog
        open={ownerOpen}
        title="Change owner"
        description="The new owner gets full control of the account, billing and members."
        confirmLabel="Make owner"
        variant="warning"
        isPending={changeOwner.isPending}
        pendingLabel="Saving…"
        onCancel={() => setOwnerOpen(false)}
        onConfirm={() => {
          if (!newOwnerId) return;
          changeOwner.mutate(newOwnerId, {
            onSuccess: () => { setOwnerOpen(false); showToast('Owner changed', 'success'); },
            onError: onFail('Could not change owner'),
          });
        }}
      >
        <select value={newOwnerId} onChange={(e) => setNewOwnerId(e.target.value)} className={INPUT}>
          <option value="">Choose a member…</option>
          {members.filter((m) => !m.is_owner).map((m) => (
            <option key={m.id} value={m.id}>{m.name ? `${m.name} (${m.email || m.id})` : m.email || m.id}</option>
          ))}
        </select>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove ${removeTarget?.name || removeTarget?.email || 'member'}?`}
        description="They lose access to this account and its shared workspaces. This frees a seat."
        confirmLabel="Remove"
        variant="danger"
        isPending={removeMember.isPending}
        pendingLabel="Removing…"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          removeMember.mutate(removeTarget.id, {
            onSuccess: () => { setRemoveTarget(null); showToast('Member removed', 'success'); },
            onError: onFail('Could not remove member'),
          });
        }}
      />

      <ConfirmDialog
        open={!!impersonateTarget}
        title={`Log in as ${impersonateTarget?.name || impersonateTarget?.email || 'member'}`}
        description="Opens Squad Hub SaaS in a new tab, signed in as this person, via a one-time link valid for 10 minutes. This is recorded in the SaaS audit log with your name and the reason below."
        confirmLabel="Log in as"
        variant="warning"
        isPending={impersonate.isPending}
        pendingLabel="Opening…"
        onCancel={() => { setImpersonateTarget(null); setImpersonateError(''); }}
        onConfirm={startImpersonation}
      >
        <label className="mt-3 block text-xs font-medium text-foreground-muted">
          Reason (required)
          <textarea
            value={impersonateReason}
            onChange={(e) => { setImpersonateReason(e.target.value); setImpersonateError(''); }}
            rows={3}
            placeholder="e.g. Reproducing the invoice bug reported in ticket #1234"
            className={INPUT}
            autoFocus
          />
        </label>
        {impersonateError && <p className="mt-2 text-xs text-red-600">{impersonateError}</p>}
      </ConfirmDialog>
    </SaasShell>
  );
}

function TalentCheckins({ hubPartnerUserId }: { hubPartnerUserId: string }) {
  const [range] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 13 * 86_400_000);
    return { from: isoDay(from), to: isoDay(to) };
  });
  const { data, isLoading, error } = useSaasCheckins(hubPartnerUserId, range.from, range.to);

  return (
    <section className={`${CARD} mb-5`}>
      <div className="flex items-center justify-between border-b border-divider px-4 py-3">
        <p className={SECTION_TITLE}>Check-ins · last 14 days</p>
      </div>
      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">Loading...</p>
      ) : error ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">{errorMessage(error, 'Could not load check-ins')}</p>
      ) : !data?.length ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">No check-ins in this period.</p>
      ) : (
        <ul>
          {data.map((c) => (
            <li key={c.id} className="flex items-start gap-3 border-b border-divider px-4 py-2.5 text-sm last:border-0">
              <span className="w-28 shrink-0 text-xs text-foreground-dim">{c.date || fmtDateTime(c.created_at)}</span>
              <span className="min-w-0 flex-1 text-foreground">
                {[c.status, c.mood].filter(Boolean).join(' · ') || 'Checked in'}
                {c.note && <span className="block text-xs text-foreground-dim">{c.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditTrail({ accountId }: { accountId: string }) {
  const { data, isLoading, error } = useSaasAudit(accountId);
  return (
    <section className={CARD}>
      <div className="border-b border-divider px-4 py-3">
        <p className={SECTION_TITLE}>Audit trail</p>
      </div>
      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">Loading...</p>
      ) : error ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">{errorMessage(error, 'Could not load the audit log')}</p>
      ) : !data?.length ? (
        <p className="px-4 py-6 text-center text-sm text-foreground-dim">No audited actions yet.</p>
      ) : (
        <ul>
          {data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 border-b border-divider px-4 py-2.5 text-sm last:border-0">
              <span className="w-40 shrink-0 text-xs text-foreground-dim">{fmtDateTime(e.created_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{e.action.replace(/[._]/g, ' ')}</span>
                {e.target && <span className="text-foreground-muted"> · {e.target}</span>}
                {e.reason && <span className="block text-xs text-foreground-dim">Reason: {e.reason}</span>}
              </span>
              <span className="text-xs text-foreground-dim">{e.actor?.name || e.actor?.email || e.actor_email || 'System'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
