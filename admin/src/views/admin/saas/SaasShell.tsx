'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSaasStatus } from './saasApi';

/** Page header + Accounts/Plans tabs. Renders the "not connected" state instead of children when the bridge is off. */
export default function SaasShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { data: status, isLoading } = useSaasStatus();
  const tabs = [
    { href: '/admin/saas-accounts', label: 'Accounts', active: pathname !== '/admin/saas-accounts/plans' },
    { href: '/admin/saas-accounts/plans', label: 'Plans', active: pathname === '/admin/saas-accounts/plans' },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {subtitle || 'Accounts on Squad Hub SaaS (app.squadhub.in). Data lives on the SaaS; changes here are audited there.'}
          </p>
        </div>
        {actions}
      </div>
      <div className="mb-5 flex gap-1 border-b border-divider">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              t.active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : status && !status.connected ? (
        <SaasNotConnected />
      ) : (
        children
      )}
    </div>
  );
}

export function SaasNotConnected() {
  return (
    <div className="rounded-lg border border-divider bg-surface px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-canvas">
        <svg className="h-5 w-5 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244M3 3l18 18" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground">SaaS not connected</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-foreground-dim">
        This server isn&apos;t linked to Squad Hub SaaS yet. Set <code className="rounded bg-canvas px-1">SAAS_API_URL</code> and{' '}
        <code className="rounded bg-canvas px-1">SAAS_BRIDGE_SECRET</code> on the API server to manage SaaS accounts here.
      </p>
    </div>
  );
}

export function SaasError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-3 text-xs font-medium underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const styles: Record<string, string> = {
    business: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    talent: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    shared: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${styles[kind] || 'bg-canvas text-foreground-muted'}`}>
      {kind}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
        active
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-400'}`} />
      {status}
    </span>
  );
}

export function SeatUsage({ used, limit }: { used?: number | null; limit?: number | null }) {
  if (used == null && limit == null) return <span className="text-foreground-dim">—</span>;
  const pct = limit ? Math.min(100, Math.round(((used || 0) / limit) * 100)) : 0;
  const full = !!limit && (used || 0) >= limit;
  return (
    <div className="min-w-[90px]">
      <span className={`text-xs ${full ? 'font-semibold text-orange-600' : 'text-foreground'}`}>
        {used ?? 0}
        {limit != null ? ` / ${limit}` : ''}
      </span>
      {limit ? (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-canvas">
          <div className={`h-full ${full ? 'bg-orange-500' : 'bg-foreground-muted'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
