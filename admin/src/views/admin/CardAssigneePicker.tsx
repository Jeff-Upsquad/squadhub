'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

export type CardAssigneeUser = {
  id: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export type CardAssignees = {
  assignee_id?: string | null;
  collaborator_ids?: string[] | null;
  assignee?: CardAssigneeUser | null;
  collaborators?: CardAssigneeUser[] | null;
};

type SalesPerson = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url?: string | null;
};

function labelOf(u: { display_name?: string | null; email?: string | null } | null | undefined, fallback = 'Unknown') {
  return u?.display_name || u?.email || fallback;
}

function initials(u: { display_name?: string | null; email?: string | null } | null | undefined) {
  const name = labelOf(u, '?');
  return name.charAt(0).toUpperCase();
}

function Avatar({
  user,
  size = 'h-6 w-6',
  className = '',
}: {
  user: CardAssigneeUser | null | undefined;
  size?: string;
  className?: string;
}) {
  if (user?.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar_url}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-white ${className}`}
      />
    );
  }
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[9px] font-bold text-[var(--color-sh-ink)] ring-1 ring-white ${className}`}
    >
      {initials(user)}
    </span>
  );
}

/**
 * No owner on a card is a gap someone has to close, not a neutral state — so it
 * reads red rather than quietly rendering nothing.
 */
export function UnassignedChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold leading-none text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300 ${className}`}
      title="No owner — no matching Squad CRM lead, and no sales person on the customer record"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Unassigned
    </span>
  );
}

/**
 * Compact owner chips for list rows: the primary owner reads solid, secondaries
 * sit behind a dashed outline so the pecking order is visible at a glance.
 */
export function CardAssigneeChips({
  card,
  max = 2,
  className = '',
}: {
  card: CardAssignees;
  /** How many secondary chips to show before collapsing into "+N". */
  max?: number;
  className?: string;
}) {
  const primary = card.assignee || null;
  const secondaries = (card.collaborators || []).filter(
    (c): c is CardAssigneeUser => !!c && c.id !== primary?.id,
  );
  if (!primary && secondaries.length === 0) return <UnassignedChip className={className} />;

  const shown = secondaries.slice(0, max);
  const overflow = secondaries.length - shown.length;
  const title = [
    primary ? `Primary: ${labelOf(primary)}` : null,
    ...secondaries.map((s) => `Secondary: ${labelOf(s)}`),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={title}>
      {primary && <OwnerChip user={primary} tone="primary" />}
      {shown.map((u) => (
        <OwnerChip key={u.id} user={u} tone="secondary" />
      ))}
      {overflow > 0 && (
        <span className="rounded-full border border-dashed border-[var(--color-sh-warm-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-sh-ink-faint)]">
          +{overflow}
        </span>
      )}
    </span>
  );
}

function OwnerChip({ user, tone }: { user: CardAssigneeUser; tone: 'primary' | 'secondary' }) {
  const isPrimary = tone === 'primary';
  return (
    <span
      className={`inline-flex max-w-[120px] items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-[10px] leading-none ${
        isPrimary
          ? 'border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] font-semibold text-[var(--color-sh-ink)]'
          : 'border border-dashed border-[var(--color-sh-warm-border)] font-medium text-[var(--color-sh-ink-muted)]'
      }`}
    >
      <Avatar user={user} size="h-4 w-4" />
      <span className="truncate">{labelOf(user)}</span>
    </span>
  );
}

type Kind = 'subscription' | 'job';

const MENU_WIDTH = 256;
const MENU_MAX_HEIGHT = 300;

/**
 * CRM-style primary + secondary picker. Saves immediately.
 * `kind` picks the PATCH endpoint (subscription cards vs job cards).
 *
 * `variant` picks the trigger: 'button' is the pill used on card detail pages,
 * 'chips' shows the owner chips themselves so a list row can be reassigned in
 * place. In a row the trigger must sit ABOVE the row's own click layer — see
 * how the rows lay themselves out.
 */
export default function CardAssigneePicker({
  cardId,
  kind,
  assigneeId,
  collaboratorIds = [],
  assignee,
  collaborators = [],
  invalidateKeys,
  variant = 'button',
}: {
  cardId: string;
  kind: Kind;
  assigneeId?: string | null;
  collaboratorIds?: string[] | null;
  assignee?: CardAssigneeUser | null;
  collaborators?: CardAssigneeUser[] | null;
  invalidateKeys: string[][];
  variant?: 'button' | 'chips';
}) {
  const qc = useQueryClient();
  const primary = assigneeId ?? assignee?.id ?? null;
  const secondaries = collaboratorIds ?? (collaborators || []).map((c) => c.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The menu is portaled to <body>: list rows lift on hover via a transform,
  // which creates a stacking context that would otherwise trap the dropdown
  // behind the next row no matter how high its z-index.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const [draft, setDraft] = useState({ primary, collaborators: secondaries });
  useEffect(() => {
    if (!open) setDraft({ primary, collaborators: secondaries });
  }, [open, primary, secondaries.join('|')]);

  const { data: peopleRes } = useQuery({
    queryKey: ['admin-sales-people'],
    queryFn: () => api.get('/admin/onboarding-links/sales-people').then((r) => r.data),
  });
  const salesPeople: SalesPerson[] = peopleRes?.data || [];

  const known = useMemo(() => {
    const map = new Map<string, CardAssigneeUser>();
    for (const p of salesPeople) map.set(p.id, p);
    if (assignee) map.set(assignee.id, assignee);
    for (const c of collaborators || []) if (c) map.set(c.id, c);
    return map;
  }, [salesPeople, assignee, collaborators]);

  const label = (id: string) => labelOf(known.get(id), id.slice(0, 8));

  const [openOrder, setOpenOrder] = useState<string[]>([]);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOpenOrder([...(primary ? [primary] : []), ...secondaries]);
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      if (!anchor) return;
      const height = menuRef.current?.offsetHeight ?? MENU_MAX_HEIGHT;
      const below = anchor.bottom + 4;
      const flip = below + height > window.innerHeight && anchor.top - height - 4 > 0;
      setMenuPos({
        top: flip ? anchor.top - height - 4 : below,
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const save = useMutation({
    mutationFn: (next: { assignee_id: string | null; collaborator_ids: string[] }) => {
      if (kind === 'job') {
        return api.patch(`/admin/job-cards/${cardId}`, next).then((r) => r.data);
      }
      return api.patch(`/admin/subscription-cards/${cardId}/assignees`, next).then((r) => r.data);
    },
    onSuccess: () => {
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Could not update owners', 'error');
    },
  });

  const emit = (next: { primary: string | null; collaborators: string[] }) => {
    setDraft(next);
    save.mutate({ assignee_id: next.primary, collaborator_ids: next.collaborators });
  };

  const isAssigned = (id: string) => id === draft.primary || draft.collaborators.includes(id);

  const toggle = (id: string) => {
    if (id === draft.primary) {
      const [nextPrimary, ...rest] = draft.collaborators;
      emit({ primary: nextPrimary ?? null, collaborators: rest });
    } else if (draft.collaborators.includes(id)) {
      emit({ primary: draft.primary, collaborators: draft.collaborators.filter((c) => c !== id) });
    } else if (!draft.primary) {
      emit({ primary: id, collaborators: draft.collaborators });
    } else {
      emit({ primary: draft.primary, collaborators: [...draft.collaborators, id] });
    }
  };

  const makePrimary = (id: string) => {
    if (id === draft.primary) return;
    const rest = draft.collaborators.filter((c) => c !== id);
    if (draft.primary) rest.unshift(draft.primary);
    emit({ primary: id, collaborators: rest });
  };

  const assignedOrder = [...(draft.primary ? [draft.primary] : []), ...draft.collaborators];
  const rank = new Map(openOrder.map((id, i) => [id, i]));
  const optionIds = new Set(salesPeople.map((p) => p.id));
  for (const id of assignedOrder) optionIds.add(id);
  const options = Array.from(optionIds)
    .map((id) => ({ id, user: known.get(id) }))
    .sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : 999;
      const rb = rank.has(b.id) ? rank.get(b.id)! : 999;
      if (ra !== rb) return ra - rb;
      return label(a.id).localeCompare(label(b.id));
    });

  const draftCard: CardAssignees = {
    assignee: draft.primary ? known.get(draft.primary) ?? { id: draft.primary } : null,
    collaborators: draft.collaborators.map((id) => known.get(id) ?? { id }),
  };

  if (variant === 'chips') {
    return (
      <div ref={ref} className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          title="Change who owns this card"
          className="rounded-full transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-sh-ink)]"
        >
          <CardAssigneeChips card={draftCard} />
        </button>
        {open && <OwnersMenu />}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-left text-[11px] font-medium transition ${
          assignedOrder.length === 0
            ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-400 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
            : 'border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] text-[var(--color-sh-ink)] hover:border-[var(--color-sh-ink)]'
        }`}
        title="Who owns this card — copied from the Squad CRM lead or deal"
      >
        {assignedOrder.length === 0 ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="font-semibold">Unassigned</span>
          </>
        ) : (
          <>
            <span className="flex -space-x-1.5">
              {assignedOrder.slice(0, 3).map((id) => (
                <Avatar key={id} user={known.get(id)} />
              ))}
            </span>
            <span className="max-w-[140px] truncate">
              {label(assignedOrder[0])}
              {assignedOrder.length > 1 && (
                <span className="text-[var(--color-sh-ink-faint)]"> +{assignedOrder.length - 1}</span>
              )}
            </span>
          </>
        )}
        <svg className={`h-3 w-3 ${assignedOrder.length === 0 ? 'text-red-400' : 'text-[var(--color-sh-ink-faint)]'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <OwnersMenu />}
    </div>
  );

  function OwnersMenu() {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: menuPos?.top ?? -9999,
            left: menuPos?.left ?? -9999,
            width: MENU_WIDTH,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
          className="z-[100] overflow-hidden rounded-lg border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] px-3 py-2">
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                assignedOrder.length === 0
                  ? 'text-red-600 dark:text-red-300'
                  : 'text-[var(--color-sh-ink-muted)]'
              }`}
            >
              {assignedOrder.length === 0 ? 'Unassigned' : 'Owners'}
            </span>
            {assignedOrder.length > 0 && (
              <button
                type="button"
                onClick={() => emit({ primary: null, collaborators: [] })}
                className="text-[11px] font-medium text-[var(--color-sh-ink-faint)] hover:text-[var(--color-sh-ink)]"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[var(--color-sh-ink-faint)]">No sales people to assign.</p>
            ) : (
              options.map(({ id, user }) => {
                const assigned = isAssigned(id);
                const isPrimary = id === draft.primary;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-sh-cream)]"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Avatar user={user} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-sh-ink)]">
                        {label(id)}
                      </span>
                      {assigned && (
                        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--color-sh-ink)]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    {assigned && (
                      <button
                        type="button"
                        onClick={() => makePrimary(id)}
                        title={isPrimary ? 'Primary owner' : 'Make primary'}
                        className={`shrink-0 ${isPrimary ? 'text-amber-500' : 'text-[var(--color-sh-ink-faint)] hover:text-amber-500'}`}
                      >
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.364 1.118l1.287 3.957c.3.922-.755 1.688-1.54 1.118l-3.367-2.447a1 1 0 00-1.176 0l-3.367 2.447c-.784.57-1.838-.196-1.539-1.118l1.286-3.957a1 1 0 00-.363-1.118L2.075 10.07c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>,
      document.body,
    );
  }
}
