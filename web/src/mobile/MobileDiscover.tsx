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
  source_content?: Record<string, unknown>;
  job_profile_id?: string | null;
  funnel_stage?: string | null;
};

type OfferStatus = 'pending_business' | 'pending_talent' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
type OfferSnapshot = {
  offer: null | {
    id: string;
    status: OfferStatus;
    current_amount?: { amount?: number; currency?: string; period?: string };
    last_actor_side?: 'talent' | 'business' | 'admin' | null;
  };
  events: Array<{ id: string; actor_type: string; action: string; amount?: { amount?: number }; note?: string | null; created_at: string }>;
  talent_bids_remaining?: number;
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
  const response = await api.get('/partner/discover/opportunities');
  return (response.data?.data || []) as SubscriptionCardRecipient[];
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
      api.patch(`/partner/discover/opportunities/${id}/respond`, { action }),
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
  const queryClient = useQueryClient();
  const card = recipient.card as OpportunityCard;
  const type = cardType(recipient);
  const content = card.source_content || {};
  const assignment = objectValue(content.assignment_details);
  const [bidEditor, setBidEditor] = useState<null | 'submit' | 'counter'>(null);
  const [bidAmount, setBidAmount] = useState(0);
  const [offerNote, setOfferNote] = useState('');

  const offerQuery = useQuery({
    queryKey: ['partner-opportunity-offer', recipient.id],
    queryFn: async () => {
      const response = await api.get(`/partner/discover/opportunities/${recipient.id}/offer`);
      return response.data as OfferSnapshot;
    },
    enabled: type !== 'hiring',
    staleTime: 10_000,
  });
  const offer = offerQuery.data?.offer || null;
  const openOffer = offer && ['pending_business', 'pending_talent', 'accepted'].includes(offer.status) ? offer : null;
  const bidsLeft = offerQuery.data?.talent_bids_remaining ?? 3;
  const listAmount = firstNumber(content.monthly_price, content.proposed_price, card.partner_price_override, card.proposed_price) || 500;
  const standingAmount = firstNumber(openOffer?.current_amount?.amount, listAmount) || 500;
  const pricingMode = type === 'assignment' && assignment.pricing_mode === 'unpriced' ? 'unpriced' : 'priced';

  const refreshOffers = async () => {
    setBidEditor(null);
    setOfferNote('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['partner-opportunity-offer', recipient.id] }),
      queryClient.invalidateQueries({ queryKey: ['partner-opportunities-discover'] }),
      queryClient.invalidateQueries({ queryKey: ['partner-opportunities'] }),
    ]);
  };
  const submitOffer = useMutation({
    mutationFn: () => api.post(`/partner/discover/opportunities/${recipient.id}/offer`, {
      amount: {
        amount: bidAmount,
        currency: stringValue(content.currency) || 'INR',
        period: type === 'assignment' ? 'project' : 'per_month',
      },
      ...(offerNote.trim() ? { note: offerNote.trim() } : {}),
    }),
    onSuccess: refreshOffers,
  });
  const respondOffer = useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'withdraw') =>
      api.post(`/partner/discover/opportunities/${recipient.id}/offer/respond`, { action }),
    onSuccess: refreshOffers,
  });
  const actionBusy = busy || submitOffer.isPending || respondOffer.isPending;
  const actionError = error || apiError(submitOffer.error) || apiError(respondOffer.error) || (offerQuery.isError ? 'Offer activity could not be loaded.' : null);

  const paymentLabel = stringValue(content.price_label) || priceLabel(card);

  const openBidEditor = (mode: 'submit' | 'counter') => {
    setBidAmount(snapBidAmount(standingAmount));
    setBidEditor(mode);
  };
  const editorTitle = bidEditor === 'submit' ? 'Submit your offer' : type === 'subscription' ? 'Place your bid' : 'Send a counter-offer';
  const editorSubmitLabel = bidEditor === 'submit' ? 'Submit offer' : type === 'subscription' ? 'Submit bid' : 'Send counter';
  const editorHint = type === 'subscription'
    ? 'Increase or decrease the set price in steps of ₹500, then submit your bid.'
    : 'Adjust the amount in steps of ₹500. Both sides can keep negotiating until you agree.';
  const editorReferenceLabel = !openOffer ? 'List price' : openOffer.last_actor_side === 'business' || openOffer.last_actor_side === 'admin' ? 'Business offer' : 'Your last bid';
  const editorReference = snapBidAmount(standingAmount);
  const editorAmountValid = bidAmount > 0 && bidAmount % 500 === 0;

  const renderFooter = () => {
    if (type === 'hiring') {
      return stageFor(recipient) === 'pending' ? (
        <footer>
          <button type="button" disabled={actionBusy} className="mdiscover-decline" onClick={() => onRespond('reject')}>Decline</button>
          <button type="button" disabled={actionBusy} className="mdiscover-accept" onClick={() => onRespond('accept')}>{actionBusy ? 'Saving…' : 'Apply'}</button>
        </footer>
      ) : null;
    }
    if (offerQuery.isLoading) return <footer className="mdiscover-offer-loading">Loading actions…</footer>;
    if (openOffer?.status === 'accepted') return <footer className="mdiscover-agreed">✓ Offer accepted</footer>;
    if (openOffer?.status === 'pending_business') {
      return (
        <footer>
          <button type="button" disabled={actionBusy} className="mdiscover-decline" onClick={() => respondOffer.mutate('withdraw')}>Withdraw</button>
          <button type="button" disabled={actionBusy || bidsLeft === 0} className="mdiscover-accept" onClick={() => openBidEditor('counter')}>Revise bid{bidsLeft > 0 ? ` (${bidsLeft} left)` : ''}</button>
        </footer>
      );
    }
    if (openOffer?.status === 'pending_talent') {
      return (
        <footer className="mdiscover-footer-three">
          <button type="button" disabled={actionBusy} className="mdiscover-decline" onClick={() => respondOffer.mutate('decline')}>Decline</button>
          <button type="button" disabled={actionBusy || bidsLeft === 0} className="mdiscover-counter" onClick={() => openBidEditor('counter')}>Counter{bidsLeft > 0 ? ` (${bidsLeft} left)` : ''}</button>
          <button type="button" disabled={actionBusy} className="mdiscover-accept" onClick={() => respondOffer.mutate('accept')}>Accept</button>
        </footer>
      );
    }
    if (stageFor(recipient) !== 'pending') return null;
    return (
      <footer className={pricingMode === 'priced' ? 'mdiscover-footer-three' : undefined}>
        <button type="button" disabled={actionBusy} className="mdiscover-decline" onClick={() => onRespond('reject')}>Decline</button>
        {pricingMode === 'priced' ? (
          <button type="button" disabled={actionBusy || bidsLeft === 0} className="mdiscover-counter" onClick={() => openBidEditor('counter')}>Bid{bidsLeft > 0 ? ` (${bidsLeft} left)` : ''}</button>
        ) : (
          <button type="button" disabled={actionBusy || bidsLeft === 0} className="mdiscover-counter" onClick={() => openBidEditor('submit')}>Submit an offer{bidsLeft > 0 ? ` (${bidsLeft} left)` : ''}</button>
        )}
        {pricingMode === 'priced' && <button type="button" disabled={actionBusy} className="mdiscover-accept" onClick={() => onRespond('accept')}>Accept</button>}
      </footer>
    );
  };

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
          {stringValue(content.imageUrl).startsWith('https://') && <img className="mdiscover-hero" src={stringValue(content.imageUrl)} alt="" referrerPolicy="no-referrer" />}
          <CanonicalCardDetails card={card} type={type} payment={paymentLabel} />
          {offerQuery.data && type !== 'hiring' && <OfferActivity snapshot={offerQuery.data} bidLabels={type === 'subscription'} />}
          {bidEditor && (
            <div className="mdiscover-modal-layer" role="presentation">
              <button type="button" className="mdiscover-modal-scrim" aria-label="Close bid editor" onClick={() => setBidEditor(null)} />
              <div className="mdiscover-modal" role="dialog" aria-modal="true" aria-label={editorTitle}>
            <section className="mdiscover-bid-editor">
              <div><h3>{editorTitle}</h3><button type="button" onClick={() => setBidEditor(null)} aria-label="Close bid editor">×</button></div>
              <p className="mdiscover-bid-hint">{editorHint}</p>
              <div className="mdiscover-stepper">
                <button type="button" disabled={bidAmount <= 500 || submitOffer.isPending} onClick={() => setBidAmount((value) => Math.max(500, value - 500))} aria-label="Decrease by 500">−</button>
                <div>
                  <p>₹{bidAmount.toLocaleString('en-IN')}</p>
                  <p>{type === 'assignment' ? 'for the project' : 'per month'}</p>
                  {bidAmount !== editorReference && <p>{editorReferenceLabel}: ₹{editorReference.toLocaleString('en-IN')}{type === 'assignment' ? '' : '/mo'}</p>}
                </div>
                <button type="button" disabled={submitOffer.isPending} onClick={() => setBidAmount((value) => value + 500)} aria-label="Increase by 500">+</button>
              </div>
              <label>Note (optional)<textarea rows={3} maxLength={2000} value={offerNote} onChange={(event) => setOfferNote(event.target.value)} placeholder="Any context for this figure…" /></label>
              <div className="mdiscover-bid-actions">
                <button type="button" disabled={submitOffer.isPending} className="mdiscover-bid-cancel" onClick={() => setBidEditor(null)}>Cancel</button>
                <button type="button" disabled={submitOffer.isPending || !editorAmountValid} className="mdiscover-bid-submit" onClick={() => submitOffer.mutate()}>{submitOffer.isPending ? 'Submitting…' : editorSubmitLabel}</button>
              </div>
            </section>
              </div>
            </div>
          )}
          {actionError && <p className="mdiscover-error">{actionError}</p>}
        </div>
        {renderFooter()}
      </article>
    </div>
  );
}

function CanonicalCardDetails({ card, type, payment }: { card: OpportunityCard; type: ProductTab; payment: string | null }) {
  const content = card.source_content || {};
  const isAssignment = type === 'assignment';
  const hoursLabel = stringValue(content.hours_label);
  const capacityLabel = stringValue(content.capacity_label);
  const deliverableNote = stringValue(content.deliverables_label) || stringValue(content.requirement_note) || card.requirement_note || '';
  const voiceUrl = stringValue(content.requirement_voice_url);
  const hasVoice = voiceUrl.startsWith('https://');
  const deliverables = normalizeDeliverables(content.custom_deliverables);
  const hasHours = Boolean(hoursLabel || capacityLabel);
  const hasDeliverables = Boolean(deliverableNote || deliverables.length > 0);
  const description = stringValue(content.description);
  const workingDays = isAssignment
    ? []
    : (stringArray(content.working_days).length ? stringArray(content.working_days) : card.working_days || []);
  const countries = stringArray(content.target_country_names);
  const languages = stringArray(content.target_languages).length ? stringArray(content.target_languages) : card.target_languages || [];
  const additional = objectValue(content.additional_requirements);
  const viewerMatch = objectValue(content.viewer_match);
  const vmCountries = flatMatchItems(viewerMatch.countries);
  const vmRegions = flatMatchItems(viewerMatch.regions);
  const vmLanguages = flatMatchItems(viewerMatch.languages);
  const hasLocationLang = vmCountries.length > 0 || vmRegions.length > 0 || vmLanguages.length > 0;
  const additionalGroups = parseAdditionalGroups(additional);
  const additionalMatchGroups = groupMatchGroups(viewerMatch.additional);
  const hasAdditionalMatch = additionalMatchGroups.length > 0;
  const hasAdditional = additionalGroups.length > 0 || hasAdditionalMatch;
  const brandName = stringValue(content.brand_name) || card.brand_name || '';
  const subscriptionName = stringValue(content.subscription_name);
  const planName = stringValue(content.plan_name) || planLabel(card) || '';
  const hasClientBrief = Boolean(brandName || subscriptionName || planName);
  const businessNature = stringValue(content.business_nature) || card.business_nature || '';
  const customerLocation = stringValue(content.customer_location);
  const clientNotes = stringValue(content.notes) || stringValue(card.notes);
  const hasAboutClient = Boolean(businessNature || customerLocation || clientNotes);
  const assignmentDetails = objectValue(content.assignment_details);
  const assignmentMeta = [
    stringValue(assignmentDetails.duration) && `Duration: ${stringValue(assignmentDetails.duration)}`,
    stringValue(assignmentDetails.start_date) && `Starts ${formatDate(stringValue(assignmentDetails.start_date))}`,
    stringValue(assignmentDetails.deadline) && `Due ${formatDate(stringValue(assignmentDetails.deadline))}`,
  ].filter(Boolean).join('  ·  ');
  const job = objectValue(content.job_profile);
  const jobFacts = [
    ['Role', stringValue(job.role) || stringValue(job.title) || stringValue(content.title)],
    ['Department', stringValue(job.department)],
    ['Employment type', stringValue(job.employment_type)],
    ['Work mode', stringValue(job.work_mode)],
    ['Location', stringValue(job.location)],
    ['Experience', stringValue(job.experience)],
    ['Qualification', stringValue(job.qualification)],
    ['Package notes', stringValue(content.package_notes)],
  ].filter((row): row is string[] => Boolean(row[1]));
  const hasStructured = hasHours || Boolean(capacityLabel) || hasDeliverables || hasVoice
    || Boolean(payment) || workingDays.length > 0 || hasClientBrief || hasAboutClient
    || countries.length > 0 || languages.length > 0 || hasAdditional || hasLocationLang;
  const showDescription = Boolean(description && !hasStructured);
  const expiresRelative = relativeExpiry(card.expires_at);

  return (
    <>
      {(hasHours || hasDeliverables || hasVoice || (!isAssignment && type !== 'hiring')) && type !== 'hiring' && (
        <DetailSection title="Work commitment" icon={LIcon.briefcase}>
          {!isAssignment && (
            <div className="mdiscover-subcard">
              <p className="mdiscover-sublabel"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.clock}</span>Hours</p>
              {hasHours ? (
                <>
                  {hoursLabel && <p className="mdiscover-hours-value">{hoursLabel}</p>}
                  {capacityLabel && <p className="mdiscover-capacity">{capacityLabel}</p>}
                </>
              ) : (
                <p className="mdiscover-placeholder">No hourly commitment</p>
              )}
            </div>
          )}
          {(!isAssignment || hasDeliverables) && (
            <div className="mdiscover-subcard">
              <p className="mdiscover-sublabel"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.clipboard}</span>Deliverables</p>
              {hasDeliverables ? (
                <>
                  {deliverableNote && <p className="mdiscover-deliverable-note">{deliverableNote}</p>}
                  {deliverables.length > 0 && (
                    <ul className="mdiscover-deliverables">
                      {deliverables.map((item, index) => (
                        <li key={`${item.label}-${index}`}>
                          <i aria-hidden="true" />
                          <div><b>{item.label}</b>{item.description && <span>{item.description}</span>}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mdiscover-placeholder">No specific deliverables</p>
              )}
            </div>
          )}
          {hasVoice && (
            <div className="mdiscover-voice">
              <p className="mdiscover-sublabel"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.mic}</span>Voice note from the client</p>
              <audio controls preload="none" src={voiceUrl} />
              <small>The client recorded the requirement in their own words — tap play to listen.</small>
            </div>
          )}
        </DetailSection>
      )}

      {type === 'hiring' && (hasDeliverables || hasVoice) && (
        <DetailSection title="Role requirements" icon={LIcon.briefcase}>
          {deliverableNote && <p className="mdiscover-deliverable-note">{deliverableNote}</p>}
          {hasVoice && (
            <div className="mdiscover-voice">
              <p className="mdiscover-sublabel"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.mic}</span>Voice note from the client</p>
              <audio controls preload="none" src={voiceUrl} />
              <small>The client recorded the requirement in their own words — tap play to listen.</small>
            </div>
          )}
        </DetailSection>
      )}

      {payment && (
        <section className="mdiscover-payment">
          <p className="mdiscover-payment-label"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.money}</span>{isAssignment ? 'Project budget' : 'Payment'}</p>
          <b>{payment}</b>
          {isAssignment && assignmentMeta && <p className="mdiscover-timeline">{assignmentMeta}</p>}
        </section>
      )}

      {showDescription && <p className="mdiscover-plain">{description}</p>}

      {(workingDays.length > 0 || hasClientBrief || hasAboutClient || countries.length > 0 || languages.length > 0 || hasAdditional || hasLocationLang) && (
        <div className="mdiscover-secondary">
          {workingDays.length > 0 && <ChipSection title="Working days" icon={LIcon.calendar} items={workingDays} />}

          {hasClientBrief && (
            <DetailSection title="Client brief" icon={LIcon.briefcase}>
              <div className="mdiscover-brief-lines">
                {brandName && <p><span>Brand:</span> <b>{brandName}</b></p>}
                {subscriptionName && <p><span>Role:</span> {subscriptionName}</p>}
                {planName && <p><span>Plan:</span> {planName}</p>}
              </div>
            </DetailSection>
          )}

          {hasAboutClient && (
            <DetailSection title="About the client" icon={LIcon.briefcase}>
              <div className="mdiscover-about-card">
                {businessNature && <p><span>Nature of business:</span> <b>{businessNature}</b></p>}
                {customerLocation && <p><span>Location of business:</span> <b>{customerLocation}</b></p>}
                {clientNotes && <p className="mdiscover-notes">{clientNotes}</p>}
              </div>
            </DetailSection>
          )}

          {!hasLocationLang && countries.length > 0 && (
            <DetailSection title={countries.length === 1 ? 'Country' : 'Countries'} icon={LIcon.globe}>
              <div className="mdiscover-chips">{countries.map((item) => <span key={item}>{item}</span>)}</div>
            </DetailSection>
          )}

          {!hasLocationLang && languages.length > 0 && (
            <DetailSection title={languages.length === 1 ? 'Language' : 'Languages'} icon={LIcon.speech}>
              <div className="mdiscover-chips">{languages.map((item) => <span key={item}>{item}</span>)}</div>
            </DetailSection>
          )}

          {hasLocationLang && (
            <DetailSection title="Location & language" icon={LIcon.globe}>
              {vmCountries.length > 0 && <MatchRow label="Country" items={vmCountries} />}
              {vmRegions.length > 0 && <MatchRow label="State / region" items={vmRegions} />}
              {vmLanguages.length > 0 && <MatchRow label="Language" items={vmLanguages} />}
            </DetailSection>
          )}

          {type === 'hiring' && jobFacts.length > 0 && (
            <DetailSection title="Job details" icon={LIcon.briefcase}><dl className="mdiscover-fact-list">{jobFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></DetailSection>
          )}

          {hasAdditional && (
            <DetailSection title="Additional requirements" icon={LIcon.sparkles} note="Optional">
              {hasAdditionalMatch
                ? additionalMatchGroups.map((group) => <MatchRow key={group.key} label={group.label} items={group.items} />)
                : additionalGroups.map((group) => <ChipRow key={group.key} label={group.label} items={group.items} />)}
              <p className="mdiscover-match-note">Nice-to-haves from the client — not required to accept this card.</p>
            </DetailSection>
          )}

          {(hasLocationLang || hasAdditionalMatch) && <MatchLegend />}
        </div>
      )}

      {expiresRelative && <p className="mdiscover-expires"><span className="mdiscover-label-icon" aria-hidden="true">{LIcon.clock}</span>Expires {expiresRelative}</p>}
    </>
  );
}

function DetailSection({ title, icon, note, children }: { title: string; icon?: ReactNode; note?: string; children: ReactNode }) {
  return <section className="mdiscover-full-section"><div className="mdiscover-full-section-title"><h3>{icon && <span className="mdiscover-label-icon" aria-hidden="true">{icon}</span>}{title}</h3>{note && <span>{note}</span>}</div>{children}</section>;
}

/** Section icons — same set as the live SquadHire card (20px outline set). */
const LIcon: Record<'briefcase' | 'clock' | 'clipboard' | 'money' | 'calendar' | 'globe' | 'speech' | 'sparkles' | 'mic', ReactNode> = {
  briefcase: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="6" width="14" height="10" rx="1.5" /><path strokeLinecap="round" d="M7.5 6V4.5h5V6 M3 10h14" /></svg>),
  clock: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="10" cy="10" r="7" /><path strokeLinecap="round" d="M10 6v4l2.5 2" /></svg>),
  clipboard: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="5" y="4" width="10" height="13" rx="1.5" /><path strokeLinecap="round" d="M8 4h4v2H8z M8 9h4 M8 12h4" /></svg>),
  money: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="10" cy="10" r="7.5" /><path strokeLinecap="round" d="M10 6v8 M12.5 7.5c-.8-.8-2-1-3-.5-1.2.5-1.2 2 0 2.5l2 .8c1.2.5 1.2 2 0 2.5-1 .5-2.2.3-3-.5" /></svg>),
  calendar: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3.5" y="5" width="13" height="11" rx="1.5" /><path strokeLinecap="round" d="M3.5 9h13 M7 3.5v3 M13 3.5v3" /></svg>),
  globe: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="10" cy="10" r="7.5" /><path strokeLinecap="round" d="M2.5 10h15 M10 2.5c2.5 2.5 2.5 12.5 0 15 M10 2.5c-2.5 2.5-2.5 12.5 0 15" /></svg>),
  speech: (<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5h12a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H9l-3 2.5v-2.5H4A1.5 1.5 0 012.5 13V7A1.5 1.5 0 014 5.5z" /></svg>),
  sparkles: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9.5 3.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3L5 8l3.3-1.2 1.2-3.3zM17 13l.8 2.2 2.2.8-2.2.8L17 19l-.8-2.2-2.2-.8 2.2-.8L17 13z" /></svg>),
  mic: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m0 0h-3.75m3.75 0h3.75M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>),
};

function ChipSection({ title, icon, items }: { title: string; icon?: ReactNode; items: string[] }) {
  const sorted = [...items].sort((a, b) => weekIndex(a) - weekIndex(b));
  const weekdays = sorted.filter((day) => !isWeekendDay(day));
  const weekends = sorted.filter(isWeekendDay);
  return (
    <DetailSection title={title} icon={icon}>
      <div className="mdiscover-day-pills">
        {weekdays.map((item) => <span key={item}>{item}</span>)}
        {weekends.length > 0 && (
          <>
            {weekdays.length > 0 && <i className="mdiscover-day-divider" aria-hidden="true" />}
            <span className="mdiscover-weekend-label">Weekend</span>
            {weekends.map((item) => <span key={item}>{item}</span>)}
          </>
        )}
      </div>
    </DetailSection>
  );
}

const WEEK_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
function weekIndex(day: string) {
  const index = WEEK_ORDER.indexOf(day.trim().slice(0, 2).toLowerCase());
  return index === -1 ? WEEK_ORDER.length : index;
}
function isWeekendDay(day: string) {
  const index = weekIndex(day);
  return index === 5 || index === 6;
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return <div className="mdiscover-chip-row"><b>{label}</b><div className="mdiscover-chips">{items.map((item) => <span key={item}>{item}</span>)}</div></div>;
}

function MatchLegend() {
  return (
    <p className="mdiscover-match-legend">
      <span><i data-match="yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></i>In your profile</span>
      <span><i data-match="no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg></i>Not in your profile</span>
    </p>
  );
}

function MatchRow({ label, items }: { label: string; items: Array<{ label: string; matched: boolean }> }) {
  return (
    <div className="mdiscover-chip-row">
      <b>{label}</b>
      <div className="mdiscover-match-chips">
        {items.map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            data-match={item.matched ? 'yes' : 'no'}
            title={item.matched ? 'In your profile' : 'Not in your profile'}
          >
            {item.matched ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
            )}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const OPEN_OFFER_STATUSES = ['pending_business', 'pending_talent', 'accepted'];

function OfferActivity({ snapshot, bidLabels }: { snapshot: OfferSnapshot; bidLabels: boolean }) {
  const [showThread, setShowThread] = useState(false);
  const offer = snapshot.offer;
  const openOffer = offer && (OPEN_OFFER_STATUSES as string[]).includes(offer.status) ? offer : null;
  const amount = firstNumber(openOffer?.current_amount?.amount);
  const bidsLeft = snapshot.talent_bids_remaining ?? 3;
  const summaryLabel = !openOffer
    ? null
    : openOffer.status === 'pending_talent'
      ? 'Business offer'
      : openOffer.status === 'accepted'
        ? 'Agreed'
        : bidLabels ? 'Your bid' : 'Your offer';
  return (
    <DetailSection title="Bid & offer activity">
      {openOffer && (
        <div className="mdiscover-offer-summary">
          <span>{summaryLabel}</span>
          <b>{amount ? `₹${amount.toLocaleString('en-IN')}` : '—'}</b>
          {openOffer.status === 'pending_business' && <small>Waiting for the business to respond.</small>}
        </div>
      )}
      <p className="mdiscover-bids-left">Bids left on this card: {bidsLeft}/3</p>
      {offer && !openOffer && (
        <p className="mdiscover-closed-note">
          {offer.status === 'declined' ? 'Previous offer declined — you can try again.' : offer.status === 'withdrawn' ? 'Offer withdrawn.' : 'Previous offer closed.'}
        </p>
      )}
      {snapshot.events.length > 0 && (
        <button type="button" className="mdiscover-thread-toggle" onClick={() => setShowThread((value) => !value)}>
          {showThread ? 'Hide' : 'View'} activity ({snapshot.events.length})
        </button>
      )}
      {showThread && snapshot.events.length > 0 && (
        <ol className="mdiscover-activity">
          {snapshot.events.map((event) => {
            const figure = firstNumber(event.amount?.amount);
            return (
              <li key={event.id}>
                <div><p><b>{offerActorName(event.actor_type)}</b> <span>{offerActionLabel(event.action)}</span></p><time>{formatDateTime(event.created_at)}</time></div>
                {figure && <p>Figure: <b>₹{figure.toLocaleString('en-IN')}</b></p>}
                {event.note && <p className="mdiscover-activity-note">{event.note}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </DetailSection>
  );
}

function offerActorName(actor: string) {
  if (actor === 'talent') return 'You';
  if (actor === 'business') return 'Business';
  if (actor === 'admin') return 'UpSquad';
  return 'System';
}

const OFFER_ACTION_LABELS: Record<string, string> = {
  submitted: 'submitted an offer',
  countered: 'sent a counter-offer',
  accepted: 'accepted the offer',
  declined: 'declined the offer',
  withdrawn: 'withdrew the offer',
  expired: 'offer expired',
  question_asked: 'asked a question',
  question_answered: 'answered a question',
};
function offerActionLabel(action: string) {
  return OFFER_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

function normalizeDeliverables(raw: unknown): Array<{ label: string; description?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value === 'string' && value.trim()) return [{ label: value.trim() }];
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (item.kind === 'hours') return [];
    const label = stringValue(item.label) || stringValue(item.name) || stringValue(item.title);
    const cadence = [item.per_day ? `${item.per_day}/day` : '', item.per_week ? `${item.per_week}/week` : '', item.per_month ? `${item.per_month}/month` : ''].filter(Boolean).join(' · ');
    const description = stringValue(item.description) || cadence;
    return label || description ? [{ label: label || 'Deliverable', ...(description ? { description } : {}) }] : [];
  });
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}
function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}
type MatchItem = { label: string; matched: boolean };
function flatMatchItems(value: unknown): MatchItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const label = stringValue(item.label) || stringValue(item.name);
    return label ? [{ label, matched: item.matched === true }] : [];
  });
}
const AR_GROUP_LABELS: Record<string, string> = {
  skills: 'Skill sets',
  tools: 'Tools',
  software: 'Software',
  ai_tools: 'AI tools',
  accounting_software: 'Accounting software',
};
function arGroupLabel(key: string) {
  return AR_GROUP_LABELS[key] || titleCase(key);
}
function parseAdditionalGroups(raw: unknown): Array<{ key: string; label: string; items: string[] }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: Array<{ key: string; label: string; items: string[] }> = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const items = stringArray(value);
    if (items.length > 0) out.push({ key, label: arGroupLabel(key), items });
  }
  return out;
}
function groupMatchGroups(raw: unknown): Array<{ key: string; label: string; items: MatchItem[] }> {
  if (!Array.isArray(raw)) return [];
  const order: string[] = [];
  const byGroup = new Map<string, MatchItem[]>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const label = stringValue(item.label) || stringValue(item.name);
    if (!label) continue;
    const key = stringValue(item.group) || 'other';
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push({ label, matched: item.matched === true });
  }
  return order.map((key) => ({ key, label: arGroupLabel(key), items: byGroup.get(key)! }));
}
function relativeExpiry(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = time - Date.now();
  if (diff <= 0) return null;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return formatter.format(Math.max(1, Math.round(diff / minute)), 'minute');
  if (diff < day) return formatter.format(Math.round(diff / hour), 'hour');
  return formatter.format(Math.round(diff / day), 'day');
}
function snapBidAmount(value: number, step = 500) {
  if (!Number.isFinite(value) || value <= 0) return step;
  return Math.max(step, Math.round(value / step) * step);
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}
function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function apiError(error: unknown): string | null {
  const message = (error as any)?.response?.data?.error || (error as any)?.response?.data?.message;
  return typeof message === 'string' ? message : error ? 'We couldn’t save that action. Please try again.' : null;
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

export function requestTitle(card: OpportunityCard) {
  return card.submission?.business_name || card.brand_name || (card.card_type === 'assignment' ? 'New assignment' : card.card_type === 'hiring' ? 'New job opening' : 'New subscription');
}
export function requestMeta(card: OpportunityCard) {
  return [card.business_nature, planLabel(card)].filter(Boolean).join(' · ');
}
function planLabel(card: OpportunityCard) {
  const plan = card.submission_subscription?.plan;
  return [plan?.plan, plan?.tier].filter(Boolean).join(' · ') || null;
}
export function priceLabel(card: OpportunityCard) {
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
