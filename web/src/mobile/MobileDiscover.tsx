'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriptionCard, SubscriptionCardRecipient } from '@squadhub/shared';
import api from '../services/api';
import { MIcon } from './MobileKit';

type TalentDestination = 'home' | 'chat' | 'notifications' | 'more';
export type ProductTab = 'subscription' | 'assignment' | 'hiring';
export type StageTab = 'pending' | 'responded' | 'expired';

export type OpportunityCard = SubscriptionCard & {
  expires_at?: string | null;
  paused_at?: string | null;
  cancelled_at?: string | null;
  requirement_note?: string | null;
};

const TALENT_NAV: Array<{ key: TalentDestination; label: string; icon: ReactNode }> = [
  { key: 'home', label: 'Home', icon: MIcon.home },
  { key: 'chat', label: 'Chatroom', icon: MIcon.chatOutline },
  { key: 'notifications', label: 'Notifications', icon: MIcon.inboxOutline },
  { key: 'more', label: 'More', icon: MIcon.moreOutline },
];

const PRODUCTS: Array<{ key: ProductTab; label: string }> = [
  { key: 'subscription', label: 'Subscriptions' },
  { key: 'assignment', label: 'Assignments' },
  { key: 'hiring', label: 'Jobs' },
];

const STAGES: Array<{ key: StageTab; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'responded', label: 'Responded' },
  { key: 'expired', label: 'Expired' },
];

export async function fetchTalentOpportunities() {
  const responses = await Promise.all(
    ['pending', 'accepted', 'rejected'].map((status) =>
      api.get(`/partner/opportunities?status=${status}`).then((response) => response.data?.data || []),
    ),
  );
  return responses.flat() as SubscriptionCardRecipient[];
}

export default function MobileDiscover({ onNavigate, hideTopNav }: { onNavigate: (destination: TalentDestination) => void; hideTopNav?: boolean }) {
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<ProductTab>('subscription');
  const [stage, setStage] = useState<StageTab>('pending');
  const [selected, setSelected] = useState<SubscriptionCardRecipient | null>(null);

  const query = useQuery({
    queryKey: ['partner-opportunities-discover'],
    queryFn: fetchTalentOpportunities,
    staleTime: 20_000,
  });

  const all = useMemo(
    () => (query.data || []).filter((item, index, rows) => rows.findIndex((row) => row.id === item.id) === index),
    [query.data],
  );
  const productItems = useMemo(() => all.filter((item) => cardType(item) === product), [all, product]);
  const visible = useMemo(() => productItems.filter((item) => stageFor(item) === stage), [productItems, stage]);
  const pendingTotal = all.filter((item) => stageFor(item) === 'pending').length;
  const productCounts = useMemo(() => ({
    subscription: all.filter((item) => cardType(item) === 'subscription' && stageFor(item) === 'pending').length,
    assignment: all.filter((item) => cardType(item) === 'assignment' && stageFor(item) === 'pending').length,
    hiring: all.filter((item) => cardType(item) === 'hiring' && stageFor(item) === 'pending').length,
  }), [all]);
  const stageCounts = useMemo(() => ({
    pending: productItems.filter((item) => stageFor(item) === 'pending').length,
    responded: productItems.filter((item) => stageFor(item) === 'responded').length,
    expired: productItems.filter((item) => stageFor(item) === 'expired').length,
  }), [productItems]);

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api.post(`/partner/opportunities/${id}/${action}`),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities'] }),
        queryClient.invalidateQueries({ queryKey: ['partner-opportunities-pending'] }),
      ]);
    },
  });

  return (
    <div className="mdiscover">
      {!hideTopNav && <TalentTopNav pending={pendingTotal} onNavigate={onNavigate} />}

      <header className="mdiscover-head">
        <span className="mdiscover-eyebrow">SquadHire talent workspace</span>
        <div className="mdiscover-title-row">
          <div>
            <h1>Work opportunities</h1>
            <p>Review requests, respond, and follow your work lifecycle.</p>
          </div>
          <span className="mdiscover-title-icon">{MIcon.discover}</span>
        </div>
      </header>

      <div className="mdiscover-tabs mdiscover-tabs--products" role="tablist" aria-label="Opportunity type">
        {PRODUCTS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={product === item.key}
            data-on={product === item.key ? 'true' : undefined}
            onClick={() => { setProduct(item.key); setStage('pending'); }}
          >
            {item.label}
            {productCounts[item.key] > 0 && <span>{productCounts[item.key]}</span>}
          </button>
        ))}
      </div>

      <div className="mdiscover-stage-tabs" role="tablist" aria-label="Request status">
        {STAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={stage === item.key}
            data-on={stage === item.key ? 'true' : undefined}
            onClick={() => setStage(item.key)}
          >
            {item.label}
            {stageCounts[item.key] > 0 && <span>{stageCounts[item.key]}</span>}
          </button>
        ))}
      </div>

      <section className="mdiscover-section" aria-live="polite">
        <div className="mdiscover-section-head">
          <div>
            <h2>{sectionTitle(product, stage)}</h2>
            <p>{sectionDescription(product, stage)}</p>
          </div>
          <button type="button" className="mdiscover-refresh" onClick={() => query.refetch()} aria-label="Refresh requests">↻</button>
        </div>

        {query.isLoading ? (
          <div className="mdiscover-skeletons" aria-label="Loading requests"><i /><i /><i /></div>
        ) : query.isError ? (
          <DiscoverEmpty title="Couldn’t load requests" body="Check your connection and try again." action="Try again" onAction={() => query.refetch()} />
        ) : visible.length === 0 ? (
          <DiscoverEmpty title={stage === 'pending' ? 'All caught up' : 'Nothing here yet'} body={emptyDescription(product, stage)} />
        ) : (
          <div className="mdiscover-list">
            {visible.map((item) => <RequestCard key={item.id} recipient={item} onClick={() => setSelected(item)} />)}
          </div>
        )}
      </section>

      {selected && (
        <RequestSheet
          recipient={selected}
          busy={respond.isPending}
          error={(respond.error as any)?.response?.data?.error || (respond.isError ? 'We couldn’t save your response.' : null)}
          onClose={() => setSelected(null)}
          onRespond={(action) => respond.mutate({ id: selected.id, action })}
        />
      )}
    </div>
  );
}

function TalentTopNav({ pending, onNavigate }: { pending: number; onNavigate: (destination: TalentDestination) => void }) {
  return (
    <nav className="mdiscover-talent-nav" aria-label="SquadHire Talent">
      {TALENT_NAV.map((item) => (
        <button
          key={item.key}
          type="button"
          data-on={item.key === 'home' ? 'true' : undefined}
          aria-current={item.key === 'home' ? 'page' : undefined}
          onClick={() => { if (item.key !== 'home') onNavigate(item.key); }}
        >
          <span className="mdiscover-talent-nav-icon">
            {item.icon}
            {item.key === 'home' && pending > 0 && <em>{pending > 99 ? '99+' : pending}</em>}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function RequestCard({ recipient, onClick }: { recipient: SubscriptionCardRecipient; onClick: () => void }) {
  const card = recipient.card as OpportunityCard | undefined;
  if (!card) return null;
  const type = cardType(recipient);
  const meta = requestMeta(card);
  const facts = requestFacts(card, type);
  return (
    <button type="button" className="mdiscover-card" data-type={type} onClick={onClick} aria-label={`Open details for ${requestTitle(card)}`}>
      <span className="mdiscover-card-icon">{typeIcon(type)}</span>
      <span className="mdiscover-card-copy">
        <span className="mdiscover-card-topline">
          <span className="mdiscover-type">{productLabel(type)}</span>
          <StatusPill recipient={recipient} />
        </span>
        <b>{requestTitle(card)}</b>
        {meta && <small>{meta}</small>}
        {facts.length > 0 && (
          <span className="mdiscover-card-facts">
            {facts.map(([label, value]) => (
              <span key={label}>
                <em>{label}</em>
                <strong>{value}</strong>
              </span>
            ))}
          </span>
        )}
        <span className="mdiscover-card-foot">
          <span>View full details</span>
          <em>{relativeDate(card.published_at || recipient.created_at)}</em>
        </span>
      </span>
      <span className="mdiscover-chevron">{MIcon.chevron}</span>
    </button>
  );
}

export function RequestSheet({ recipient, busy, error, onClose, onRespond }: {
  recipient: SubscriptionCardRecipient;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRespond: (action: 'accept' | 'reject') => void;
}) {
  const card = recipient.card as OpportunityCard;
  const type = cardType(recipient);
  const details = [
    ['Engagement', productLabel(type)],
    ['Plan / level', planLabel(card)],
    ['Budget', priceLabel(card)],
    ['Working days', card.working_days?.join(', ')],
    ['Languages', card.target_languages?.join(', ')],
    ['Experience', card.min_experience_years ? `${card.min_experience_years}+ years` : null],
    ['Timeline', card.assignment_details?.duration],
    ['Start date', formatDate(card.assignment_details?.start_date)],
    ['Deadline', formatDate(card.assignment_details?.deadline)],
    ['Expires', formatDate(card.expires_at)],
  ].filter((row): row is string[] => Boolean(row[1]));

  return (
    <div className="mdiscover-sheet-layer" role="presentation">
      <button type="button" className="mdiscover-sheet-scrim" aria-label="Close request" onClick={onClose} />
      <article className="mdiscover-sheet" role="dialog" aria-modal="true" aria-labelledby="request-title">
        <div className="mdiscover-sheet-handle" />
        <header>
          <span className="mdiscover-card-icon" data-large>{typeIcon(type)}</span>
          <div>
            <span className="mdiscover-type">{productLabel(type)}</span>
            <h2 id="request-title">{requestTitle(card)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">{MIcon.close}</button>
        </header>
        <div className="mdiscover-sheet-scroll">
          <div className="mdiscover-sheet-summary">
            <StatusPill recipient={recipient} />
            <span>{card.submission?.business_name || card.brand_name || 'SquadHub client'}</span>
          </div>
          {details.length > 0 && (
            <dl className="mdiscover-details">
              {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
          {(card.requirement_note || card.notes) && (
            <section className="mdiscover-brief"><h3>Work brief</h3><p>{card.requirement_note || card.notes}</p></section>
          )}
          {card.additional_requirements && Object.keys(card.additional_requirements).length > 0 && (
            <section className="mdiscover-brief">
              <h3>Preferred skills & tools</h3>
              <div className="mdiscover-chips">
                {Object.values(card.additional_requirements).flat().map((label) => <span key={label}>{label}</span>)}
              </div>
            </section>
          )}
          {error && <p className="mdiscover-error">{error}</p>}
        </div>
        {stageFor(recipient) === 'pending' && (
          <footer>
            <button type="button" disabled={busy} className="mdiscover-decline" onClick={() => onRespond('reject')}>Decline</button>
            <button type="button" disabled={busy} className="mdiscover-accept" onClick={() => onRespond('accept')}>
              {busy ? 'Saving…' : type === 'assignment' ? 'Accept assignment' : type === 'hiring' ? 'I’m interested' : 'Accept request'}
            </button>
          </footer>
        )}
      </article>
    </div>
  );
}

function StatusPill({ recipient }: { recipient: SubscriptionCardRecipient }) {
  const card = recipient.card as OpportunityCard | undefined;
  const state = card?.cancelled_at ? 'cancelled' : card?.recalled_at ? 'recalled' : card?.paused_at ? 'paused' : recipient.status === 'pending' && isExpired(recipient) ? 'expired' : card?.state === 'assigned' ? 'active' : recipient.status;
  return <span className="mdiscover-status" data-status={state}>{state === 'pending' ? 'New' : state[0].toUpperCase() + state.slice(1)}</span>;
}

function DiscoverEmpty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mdiscover-empty">
      <span>{MIcon.inboxOutline}</span><b>{title}</b><p>{body}</p>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

export function cardType(recipient: SubscriptionCardRecipient): ProductTab {
  const type = recipient.card?.card_type;
  return type === 'assignment' || type === 'hiring' ? type : 'subscription';
}

function isExpired(recipient: SubscriptionCardRecipient) {
  const card = recipient.card as OpportunityCard | undefined;
  if (!card?.expires_at) return false;
  const expiry = new Date(card.expires_at).getTime();
  return Number.isFinite(expiry) && expiry < Date.now();
}

export function stageFor(recipient: SubscriptionCardRecipient): StageTab {
  if (recipient.status === 'pending' && isExpired(recipient)) return 'expired';
  return recipient.status === 'pending' ? 'pending' : 'responded';
}

function requestTitle(card: OpportunityCard) {
  return card.submission_subscription?.subscription?.name || card.brand_name || (card.card_type === 'assignment' ? 'New assignment' : card.card_type === 'hiring' ? 'New job opening' : 'New subscription');
}
function requestMeta(card: OpportunityCard) {
  return [card.submission?.business_name || card.business_nature, planLabel(card)].filter(Boolean).join(' · ');
}
function planLabel(card: OpportunityCard) {
  const plan = card.submission_subscription?.plan;
  return [plan?.plan, plan?.tier].filter(Boolean).join(' · ') || null;
}
function priceLabel(card: OpportunityCard) {
  const amount = card.partner_price_override ?? card.proposed_price;
  if (amount == null) return null;
  return `₹${Number(amount).toLocaleString('en-IN')}${card.card_type === 'assignment' ? ' / project' : ' / month'}`;
}
function requestFacts(card: OpportunityCard, type: ProductTab): string[][] {
  const plan = card.submission_subscription?.plan;
  const commitment = type === 'subscription'
    ? [plan?.daily_hours != null ? `${plan.daily_hours}h/day` : null, plan?.weekly_hours != null ? `${plan.weekly_hours}h/week` : null].filter(Boolean).join(' · ')
    : card.assignment_details?.duration || null;
  const timing = type === 'assignment'
    ? formatDate(card.assignment_details?.deadline)
    : formatDate(card.expires_at);
  return [
    ['Pay', priceLabel(card)],
    [type === 'subscription' ? 'Commitment' : 'Timeline', commitment],
    [type === 'assignment' ? 'Deadline' : 'Respond by', timing],
  ].filter((row): row is string[] => Boolean(row[1])).slice(0, 3);
}
function typeIcon(type: ProductTab) {
  if (type === 'assignment') return MIcon.tasks;
  if (type === 'hiring') return MIcon.profile;
  return MIcon.calendar;
}
function productLabel(product: ProductTab) {
  if (product === 'assignment') return 'Assignment';
  if (product === 'hiring') return 'Job opening';
  return 'Subscription';
}
function sectionTitle(product: ProductTab, stage: StageTab) {
  if (stage === 'pending') return `New ${product === 'hiring' ? 'job openings' : product === 'assignment' ? 'assignments' : 'subscriptions'}`;
  if (stage === 'expired') return `Expired ${product === 'hiring' ? 'jobs' : product === 'assignment' ? 'assignments' : 'subscriptions'}`;
  return `Responded ${product === 'hiring' ? 'jobs' : product === 'assignment' ? 'assignments' : 'subscriptions'}`;
}
function sectionDescription(product: ProductTab, stage: StageTab) {
  if (stage === 'pending') return 'Requests waiting for your response';
  if (stage === 'expired') return 'Requests whose response window has closed';
  return product === 'hiring' ? 'Roles you accepted or declined' : 'Offers you accepted or declined';
}
function emptyDescription(product: ProductTab, stage: StageTab) {
  if (stage === 'pending') return `You don’t have any pending ${product === 'hiring' ? 'jobs' : product === 'assignment' ? 'assignments' : 'subscriptions'} right now.`;
  if (stage === 'expired') return 'Expired requests will remain here for reference.';
  return 'Offers you respond to will appear here.';
}
function relativeDate(value: string | null | undefined) {
  if (!value) return '';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(value));
}
function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
