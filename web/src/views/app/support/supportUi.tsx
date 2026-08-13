import type { SupportTicket, SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@squadhub/shared';

export const CATEGORY_META: Record<SupportTicketCategory, { label: string; chip: string }> = {
  technical: { label: 'Technical', chip: 'bg-indigo-50 text-indigo-700' },
  accounts: { label: 'Accounts', chip: 'bg-sky-50 text-sky-700' },
  financial: { label: 'Financial', chip: 'bg-amber-50 text-amber-700' },
  general: { label: 'General', chip: 'bg-slate-100 text-slate-600' },
};

const PRIORITY_META: Record<SupportTicketPriority, { label: string; dot: string }> = {
  low: { label: 'Low', dot: 'bg-slate-400' },
  normal: { label: 'Normal', dot: 'bg-emerald-500' },
  high: { label: 'High', dot: 'bg-amber-500' },
  urgent: { label: 'Urgent', dot: 'bg-red-500' },
};

export function ticketCode(t: Pick<SupportTicket, 'ticket_number'>) {
  return `SUP-${t.ticket_number}`;
}

export function StatusPill({ status }: { status: SupportTicketStatus }) {
  return status === 'open' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Closed
    </span>
  );
}

export function PriorityDot({ priority, withLabel }: { priority: SupportTicketPriority; withLabel?: boolean }) {
  const p = PRIORITY_META[priority];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${p.dot}`} />
      {withLabel && <span>{p.label}</span>}
    </span>
  );
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
