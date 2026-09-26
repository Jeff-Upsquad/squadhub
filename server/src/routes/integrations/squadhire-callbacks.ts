import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../../config';
import { supabaseAdmin } from '../../supabase';
import { logCardEvent } from '../../utils/cardEvents';
import { clientViewRemoteEventSchema, logClientViewRemoteEvent } from '../../utils/squadhireClientViewEvents';
import { endActiveAssignmentTermsForCard } from '../../utils/assignmentTerms';
import { lockAcceptedBidPrice } from '../../utils/lockAcceptedBidPrice';
import { ensureSquadhireTalentProvisioned } from '../../utils/squadhireTalentSession';
import { SquadhireSsoError } from '../../utils/squadhireSsoShared';
import { createApprovedKnowledge } from '../../services/knowledgeFromSquadhire';
import { currentPartnerManifest } from '../partner-app';

/**
 * Inbound callbacks from SquadHire.
 *
 * When a talent accepts or rejects a subscription card in SquadHire, Profiles
 * POSTs to us here. We persist the response into
 * `subscription_card_external_recipients` (kept separate from our own
 * internal `subscription_card_recipients`). Idempotent on the (card,
 * external_recipient_id) tuple so Profiles' sweeper retries don't create
 * duplicates.
 *
 * Auth: simple shared-secret header, constant-time compared. This mirrors
 * Profiles' own webhook middleware. If the secret is unset, respond 503 so
 * SquadHire keeps the row queued and retries later rather than silently
 * accepting unauthenticated writes.
 */

const router = Router();

const HEADER_NAME = 'x-squadhub-signature';

function verifySquadhireCallbackSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = config.squadhireCallbackSecret;
  if (!expected) {
    res.status(503).json({ success: false, error: 'SquadHire callback secret not configured' });
    return;
  }
  const provided = req.header(HEADER_NAME) ?? req.header('X-SquadHub-Signature');
  if (typeof provided !== 'string' || provided.length === 0) {
    res.status(401).json({ success: false, error: 'Missing webhook signature' });
    return;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    return;
  }
  next();
}

const cardResponseSchema = z
  .object({
    external_id: z.string().min(1),        // SquadHub card id (UUID as string)
    recipient_id: z.string().min(1),        // Profiles' own recipient row id
    talent_user_id: z.string().min(1),      // Profiles' talent user id
    talent_name: z.string().min(1).optional(), // Display name; older deploys may omit it
    action: z.enum(['accept', 'reject']),
    responded_at: z.string().datetime(),
  })
  .strict();

const talentProvisionSchema = z
  .object({
    card_id: z.string().uuid(),
    talent_user_id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    category_slug: z.string().min(1).nullable(),
  })
  .strict();

const groupMeetNoticeSchema = z
  .object({
    kind: z.enum(['invite', 'rescheduled', 'cancelled', 'join']),
    title: z.string().min(1),
    body: z.string().optional().default(''),
    card_id: z.string().uuid(),
    meeting_id: z.string().uuid(),
    talents: z.array(z.object({
      talent_user_id: z.string().uuid(),
      email: z.string().email(),
    })).min(1),
  })
  .strict();

// One-off SquadHire notice for a talent (application approved / rejected).
// Addressed by email because the talent may not hold a SquadHub account yet —
// unknown emails are skipped, not errors.
const talentNoticeSchema = z
  .object({
    kind: z.enum(['application_approved', 'application_rejected']),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional().default(''),
    route: z.string().max(200).optional().default('/notifications'),
    emails: z.array(z.string().email()).min(1).max(50),
  })
  .strict();

// Every SquadHire talent push (opportunities, shortlist/selection, job stages,
// chatroom messages, broadcasts) mirrored so the partner app's Discover
// surface gets it — SquadHire's own FCM only reaches the retired talent app.
// `type` is SquadHire's push type, kept verbatim because the partner app
// routes on it. Group Meet has its own endpoint above.
const TALENT_PUSH_TYPES = [
  'new_card', 'selected', 'shortlisted', 'cancelled', 'unassigned', 'assignment_offer',
  'job_new_card', 'job_stage', 'job_interview', 'job_interview_confirm',
  'job_interview_start', 'job_offer', 'job_hired', 'broadcast',
] as const;

const talentPushNoticeSchema = z
  .object({
    type: z.enum(TALENT_PUSH_TYPES),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional().default(''),
    route: z.string().max(300).optional().default('/talent/notifications'),
    card_id: z.string().uuid().nullable().optional(),
    card_type: z.string().max(40).nullable().optional(),
    // 'shortlist' | 'selection' make the partner app show its full-screen
    // confirm/decline alert; needs the talent's recipient_id to act on.
    notification_kind: z.enum(['shortlist', 'selection']).nullable().optional(),
    business_name: z.string().max(200).nullable().optional(),
    card_title: z.string().max(200).nullable().optional(),
    talents: z.array(z.object({
      email: z.string().email(),
      recipient_id: z.string().uuid().nullable().optional(),
    })).min(1).max(200),
  })
  .strict();

// Assignment-time partner provisioning. The signed caller supplies identity,
// but the local assigned card is the entitlement: a valid signature alone can
// never create a partner who is not actually assigned on this SquadHub card.
router.post(
  '/talent/provision',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = talentProvisionSchema.parse(req.body);
      const { data: card, error: cardError } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, state, selected_recipient_type, selected_recipient_id')
        .eq('id', body.card_id)
        .maybeSingle();
      if (cardError) {
        res.status(500).json({ success: false, error: cardError.message });
        return;
      }
      if (!card) {
        res.status(404).json({ success: false, error: 'Assigned card not found' });
        return;
      }
      if (
        card.state !== 'assigned' ||
        card.selected_recipient_type !== 'talent' ||
        card.selected_recipient_id !== body.talent_user_id
      ) {
        res.status(409).json({ success: false, error: 'Talent is not assigned to this card' });
        return;
      }

      const result = await ensureSquadhireTalentProvisioned(
        {
          talent_user_id: body.talent_user_id,
          email: body.email.trim().toLowerCase(),
          name: body.name,
          phone: body.phone,
          category_slug: body.category_slug,
        },
        // Account + workspace membership are the assignment contract. Client
        // folder reconciliation is best-effort because legacy cards may not
        // yet map to a client (and must not strand the talent outside SquadHub).
        { strictAccessSync: false },
      );
      res.json({
        success: true,
        data: { user_id: String(result.user.id), created: result.created },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      if (err instanceof SquadhireSsoError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      console.error('[squadhire-callback talent/provision] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

router.post(
  '/card-responses',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = cardResponseSchema.parse(req.body);

      // Look up the card by its SquadHub id (we send it as external_id). If
      // it's missing the card was deleted after publish — return 200 so
      // Profiles stops retrying. This is not a case we can hit by accident.
      const { data: card, error: cardErr } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('id', body.external_id)
        .maybeSingle();
      if (cardErr) {
        res.status(500).json({ success: false, error: cardErr.message });
        return;
      }
      if (!card) {
        res.status(200).json({ success: true, ignored: 'card_not_found' });
        return;
      }

      const status = body.action === 'accept' ? 'accepted' : 'rejected';

      const { error: upErr } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .upsert(
          {
            card_id: card.id,
            external_system: 'squadhire',
            external_recipient_id: body.recipient_id,
            external_user_id: body.talent_user_id,
            talent_name: body.talent_name ?? null,
            status,
            responded_at: body.responded_at,
          },
          { onConflict: 'card_id,external_system,external_recipient_id' },
        );
      if (upErr) {
        res.status(500).json({ success: false, error: upErr.message });
        return;
      }

      // Clean up any manual-assignment duplicate for the same talent.
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .delete()
        .eq('card_id', card.id)
        .eq('external_user_id', body.talent_user_id)
        .neq('external_recipient_id', body.recipient_id);

      await logCardEvent({
        cardId: card.id,
        eventType: status === 'accepted' ? 'recipient_accepted' : 'recipient_declined',
        actorId: body.talent_user_id,
        actorType: 'talent',
        actorLabel: body.talent_name ?? null,
        metadata: { channel: 'talent' },
      });

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ------------------------------------------------------------
// POST /card-selection — SquadHire admin selected a talent
// ------------------------------------------------------------

const cardSelectionSchema = z
  .object({
    external_id: z.string().min(1),
    recipient_id: z.string().min(1),
    talent_user_id: z.string().min(1),
    talent_name: z.string().min(1).optional(),
    selected_at: z.string().datetime(),
    // Optional agreed bid (business-side amount + optional partner_amount).
    // When omitted we pull the accepted offer from SquadHire's offers snapshot.
    agreed_amount: z
      .object({
        amount: z.number().positive(),
        partner_amount: z.number().nonnegative().optional(),
        side: z.enum(['business', 'talent']).optional(),
        currency: z.string().optional(),
        period: z.string().optional(),
      })
      .optional(),
  })
  .strict();

router.post(
  '/card-selection',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = cardSelectionSchema.parse(req.body);

      const { data: card, error: cardErr } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, state, selected_recipient_type')
        .eq('id', body.external_id)
        .maybeSingle();
      if (cardErr) { res.status(500).json({ success: false, error: cardErr.message }); return; }
      if (!card) { res.status(200).json({ success: true, ignored: 'card_not_found' }); return; }

      if (card.selected_recipient_type) {
        res.status(200).json({ success: true, ignored: 'already_selected' });
        return;
      }

      const now = body.selected_at;

      // Stamp the selected talent
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ selected_at: now })
        .eq('card_id', card.id)
        .eq('external_user_id', body.talent_user_id);

      // Pass over all other accepted external recipients
      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', card.id)
        .eq('status', 'accepted')
        .neq('external_user_id', body.talent_user_id)
        .is('passed_over_at', null);

      // Pass over all accepted partners
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: now })
        .eq('card_id', card.id)
        .eq('status', 'accepted')
        .is('passed_over_at', null);

      // Move the card to the "Selected" (pending admin approval) stage — NOT
      // straight to Assigned. state='assigned' with NO selected_recipient_id
      // buckets the card as "Selected" on the admin side (selected_recipient_id
      // is what flips it to "Assigned"), closes the slot to other talents, and
      // maps to status 'assigned' in the SquadHire payload builder.
      //
      // We deliberately do NOT set selected_recipient_id / assigned_at, and do
      // NOT open the billing term here. An admin must approve via
      // /finalize-selection, which stamps the recipient + assigned_at, opens the
      // assignment term (so the engagement START DATE = admin-assign time), and
      // notifies SquadHire activation. See subscription-cards-admin-select.ts.
      await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'assigned',
          closed_at: null,
          // A fresh selection starts unpaused regardless of prior rounds.
          paused_at: null,
        })
        .eq('id', card.id);

      // Freeze the negotiated bid for this talent onto the card so admin +
      // Leads mini-app show the final agreed business / talent prices.
      lockAcceptedBidPrice({
        cardId: card.id,
        talentUserId: body.talent_user_id,
        amount: body.agreed_amount ?? null,
      }).catch((err) => {
        console.error('[squadhire-callback card-selection] lock bid price failed', err);
      });

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback card-selection] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ------------------------------------------------------------
// POST /card-selection-undo — SquadHire admin undid a selection
// ------------------------------------------------------------

const cardSelectionUndoSchema = z
  .object({
    external_id: z.string().min(1),
  })
  .strict();

router.post(
  '/card-selection-undo',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = cardSelectionUndoSchema.parse(req.body);

      const { data: card } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('id', body.external_id)
        .maybeSingle();
      if (!card) { res.status(200).json({ success: true, ignored: 'card_not_found' }); return; }

      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ selected_at: null, selected_by: null, passed_over_at: null })
        .eq('card_id', card.id)
        .not('selected_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: null })
        .eq('card_id', card.id)
        .not('passed_over_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ selected_at: null, selected_by: null, passed_over_at: null })
        .eq('card_id', card.id)
        .not('selected_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: null })
        .eq('card_id', card.id)
        .not('passed_over_at', 'is', null);

      await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'published',
          closed_at: null,
          // A published card can't be "paused" — don't strand the marker.
          paused_at: null,
          selected_recipient_type: null,
          selected_recipient_id: null,
        })
        .eq('id', card.id);

      // The selection was reversed — close any open ledger term so we stop
      // counting it as an active (billable) engagement.
      await endActiveAssignmentTermsForCard(card.id);

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback card-selection-undo] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ------------------------------------------------------------
// POST /card-activation-undo — SquadHire unassigned a card whose
// subscription had already been ACTIVATED (finalized). Reverse the
// finalize-selection so the card reopens for re-selection.
//
// Profiles fires this alongside /card-selection-undo when an *activated*
// card is unassigned, in no guaranteed order — so this handler is a
// self-sufficient, idempotent superset of selection-undo: it fully reopens
// the card AND clears the finalize + activation-notify residue.
//
// NOTE: activation on this side does NOT start billing — `client_subscriptions`
// are owned by the lead→client pipeline and have no FK to the card — so we
// deliberately do NOT touch billing here.
// ------------------------------------------------------------

const cardActivationUndoSchema = z
  .object({
    external_id: z.string().min(1),
    unassigned_at: z.string().datetime().optional(),
  })
  .strict();

router.post(
  '/card-activation-undo',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = cardActivationUndoSchema.parse(req.body);

      const { data: card } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .eq('id', body.external_id)
        .maybeSingle();
      if (!card) { res.status(200).json({ success: true, ignored: 'card_not_found' }); return; }

      // Clear selection on both recipient tables (partners + SquadHire talents).
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ selected_at: null, selected_by: null, passed_over_at: null })
        .eq('card_id', card.id)
        .not('selected_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ passed_over_at: null })
        .eq('card_id', card.id)
        .not('passed_over_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ selected_at: null, selected_by: null, passed_over_at: null })
        .eq('card_id', card.id)
        .not('selected_at', 'is', null);

      await supabaseAdmin
        .from('subscription_card_external_recipients')
        .update({ passed_over_at: null })
        .eq('card_id', card.id)
        .not('passed_over_at', 'is', null);

      // Reopen the card and clear the finalize + activation-notify residue so a
      // fresh selection/activation can happen cleanly later.
      await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'published',
          closed_at: null,
          assigned_at: null,
          // A published card can't be "paused" — don't strand the marker.
          paused_at: null,
          selected_recipient_type: null,
          selected_recipient_id: null,
          squadhire_activation_notified_at: null,
          squadhire_activation_notify_attempts: 0,
          squadhire_activation_notify_error: null,
        })
        .eq('id', card.id);

      // Unassigned — close any open ledger term for this card.
      await endActiveAssignmentTermsForCard(card.id);

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback card-activation-undo] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ------------------------------------------------------------
// Profile access grants: inbound sync from Profiles → SquadHub
// ------------------------------------------------------------

const grantUpsertSchema = z
  .object({
    profiles_grant_id: z.string().uuid(),
    email: z.string().email(),
    category_ids: z.array(z.string().uuid()),
    expires_at: z.string().datetime(),
    revoked_at: z.string().datetime().nullable().optional(),
    notes: z.string().nullable().optional(),
    // When SquadHub originated this grant, Profiles echoes back the
    // originating SquadHub user id so we can rebind it on the mirror row.
    // Otherwise NULL = the row is admin-only on the SquadHub side.
    created_by_squadhub_user_id: z.string().uuid().nullable().optional(),
    action: z.enum(['create', 'update', 'revoke']).default('update'),
  })
  .strict();

const grantDeleteSchema = z
  .object({
    profiles_grant_id: z.string().uuid(),
  })
  .strict();

router.post(
  '/grant-upserts',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = grantUpsertSchema.parse(req.body);

      // Idempotent on profiles_grant_id (UNIQUE). When SquadHub originated
      // the grant, the row already exists locally and was synced; the upsert
      // here is the round-trip echo confirming receipt — we re-apply the
      // canonical fields so any drift in the meantime is corrected.
      const upsertData: Record<string, unknown> = {
        profiles_grant_id: body.profiles_grant_id,
        email: body.email.toLowerCase(),
        category_ids: body.category_ids,
        expires_at: body.expires_at,
        revoked_at: body.revoked_at ?? null,
        notes: body.notes ?? null,
        // Mark the row as already synced — Profiles is the originator on this
        // path, so there's nothing for our outbound sweeper to push back.
        profiles_synced_at: new Date().toISOString(),
        profiles_sync_last_error: null,
      };
      if (body.created_by_squadhub_user_id !== undefined) {
        upsertData.created_by = body.created_by_squadhub_user_id;
      }

      const { error: upErr } = await supabaseAdmin
        .from('profile_access_grants')
        .upsert(upsertData, { onConflict: 'profiles_grant_id' });
      if (upErr) {
        res.status(500).json({ success: false, error: upErr.message });
        return;
      }

      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback grant-upserts] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

router.post(
  '/grant-deletes',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = grantDeleteSchema.parse(req.body);
      const { error } = await supabaseAdmin
        .from('profile_access_grants')
        .delete()
        .eq('profiles_grant_id', body.profiles_grant_id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback grant-deletes] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// SquadHire Group Meet invite / reschedule / cancel — write an inbox row so
// the partner-app poller can FCM it. Talent using Discover never sees the
// retired SquadHire talent-app push channel.
router.post(
  '/talent/group-meet-notice',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = groupMeetNoticeSchema.parse(req.body);
      const type = body.kind === 'invite'
        ? 'group_meet_invite'
        : body.kind === 'rescheduled'
          ? 'group_meet_rescheduled'
          : body.kind === 'join'
            ? 'group_meet_join'
            : 'group_meet_cancelled';
      const needsRsvp = body.kind === 'invite' || body.kind === 'rescheduled';
      const route = body.kind === 'join'
        ? `/group-meet/${body.meeting_id}?action=join`
        : `/group-meet/${body.meeting_id}`;
      const emails = [...new Set(body.talents.map((t) => t.email.trim().toLowerCase()).filter(Boolean))];
      const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .in('email', emails);
      if (userError) {
        res.status(500).json({ success: false, error: userError.message });
        return;
      }
      const byEmail = new Map((users ?? []).map((u) => [String(u.email || '').toLowerCase(), u.id as string]));
      const rows = emails.flatMap((email) => {
        const userId = byEmail.get(email);
        if (!userId) return [];
        return [{
          user_id: userId,
          type,
          reference_id: body.meeting_id,
          reference_type: 'group_meet',
          title: body.title,
          body: body.body || null,
          metadata: {
            route,
            meeting_id: body.meeting_id,
            card_id: body.card_id,
            action_required: needsRsvp ? 'true' : 'false',
            notification_kind: 'group_meet',
          },
        }];
      });
      if (rows.length === 0) {
        res.json({ success: true, data: { inserted: 0 } });
        return;
      }
      const { error: insertError } = await supabaseAdmin.from('notifications').insert(rows);
      if (insertError) {
        res.status(500).json({ success: false, error: insertError.message });
        return;
      }
      res.json({ success: true, data: { inserted: rows.length } });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback talent/group-meet-notice] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

router.post(
  '/talent/notice',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = talentNoticeSchema.parse(req.body);
      const emails = [...new Set(body.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .in('email', emails);
      if (userError) {
        res.status(500).json({ success: false, error: userError.message });
        return;
      }
      const rows = (users ?? []).map((u) => ({
        user_id: u.id as string,
        type: body.kind,
        // reference_id is NOT NULL and an announcement has no entity of its
        // own — the tap opens the row by its notification id.
        reference_id: u.id as string,
        // 'announcement' → the partner app opens the inline detail on tap.
        reference_type: 'announcement',
        title: body.title,
        body: body.body || null,
        metadata: { route: body.route, notification_kind: body.kind },
      }));
      if (rows.length === 0) {
        res.json({ success: true, data: { inserted: 0 } });
        return;
      }
      const { error: insertError } = await supabaseAdmin.from('notifications').insert(rows);
      if (insertError) {
        res.status(500).json({ success: false, error: insertError.message });
        return;
      }
      res.json({ success: true, data: { inserted: rows.length } });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback talent/notice] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// Mirror a SquadHire talent push into the inbox; the notifications poller then
// FCMs it to the partner app (sendPartnerPush). Emails without a SquadHub
// account are skipped — most talents never sign in to the partner app.
router.post(
  '/talent/push-notice',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = talentPushNoticeSchema.parse(req.body);
      const recipientByEmail = new Map<string, string | null>();
      for (const t of body.talents) {
        const email = t.email.trim().toLowerCase();
        if (email && !recipientByEmail.has(email)) recipientByEmail.set(email, t.recipient_id ?? null);
      }
      const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .in('email', [...recipientByEmail.keys()]);
      if (userError) {
        res.status(500).json({ success: false, error: userError.message });
        return;
      }
      const rows = (users ?? []).map((u) => {
        const userId = u.id as string;
        const recipientId = recipientByEmail.get(String(u.email || '').toLowerCase()) ?? null;
        // The confirm/decline alert acts on a recipient; without one the push
        // degrades to a plain "open this opportunity" notification.
        const kind = recipientId ? body.notification_kind ?? null : null;
        return {
          user_id: userId,
          type: body.type,
          reference_type: kind ?? 'opportunity',
          reference_id: recipientId ?? body.card_id ?? userId,
          title: body.title,
          body: body.body || null,
          metadata: {
            route: body.route,
            card_id: body.card_id ?? null,
            card_type: body.card_type ?? null,
            notification_kind: kind,
            business_name: body.business_name ?? null,
            card_title: body.card_title ?? null,
            source: 'squadhire',
          },
        };
      });
      if (rows.length === 0) {
        res.json({ success: true, data: { inserted: 0 } });
        return;
      }
      const { error: insertError } = await supabaseAdmin.from('notifications').insert(rows);
      if (insertError) {
        res.status(500).json({ success: false, error: insertError.message });
        return;
      }
      res.json({ success: true, data: { inserted: rows.length } });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback talent/push-notice] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// Operator embed + the customer's own portal both POST here so the Hub activity
// log can label the click as SquadHub operator vs the business.
router.post(
  '/cards/client-view/events',
  verifySquadhireCallbackSecret,
  async (req: Request, res: Response) => {
    try {
      const body = clientViewRemoteEventSchema.parse(req.body);
      const result = await logClientViewRemoteEvent(body);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, duplicate: result.duplicate ?? false });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('[squadhire-callback client-view-events] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// POST /integrations/squadhire/knowledge — Squad Bot's learning loop. An admin
// approved a Q&A drafted from a handed-off talent chat; save it as a published
// Knowledge item (synced back to SquadHire straight away).
const approvedKnowledgeSchema = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(1).max(8000),
  categories: z.array(z.string().min(1).max(100)).min(1).max(50),
});

router.post('/knowledge', verifySquadhireCallbackSecret, async (req: Request, res: Response) => {
  try {
    const body = approvedKnowledgeSchema.parse(req.body);
    const id = await createApprovedKnowledge(body);
    res.status(201).json({ success: true, data: { id } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0]?.message ?? 'Invalid knowledge' });
      return;
    }
    console.error('[squadhire-callback knowledge] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// Partner app installs, read by SquadHire's sync. SquadHire matches rows to its
// talents by email; `latest` is the build the in-app updater currently offers.
router.get('/partner-app/installs', verifySquadhireCallbackSecret, async (_req: Request, res: Response) => {
  try {
    const PAGE = 1000;
    const installs: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('partner_app_installs')
        .select('user_id, platform, version_name, version_code, first_seen_at, last_seen_at, users(email)')
        .order('user_id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as any[]) {
        const email = (row.users?.email as string | undefined)?.trim().toLowerCase();
        if (!email) continue;
        installs.push({
          squadhub_user_id: row.user_id,
          email,
          platform: row.platform,
          version_name: row.version_name,
          version_code: row.version_code,
          first_seen_at: row.first_seen_at,
          last_seen_at: row.last_seen_at,
        });
      }
      if (!data || data.length < PAGE) break;
    }
    const manifest = currentPartnerManifest();
    res.json({
      success: true,
      data: {
        installs,
        latest: { version_code: manifest.version_code, version_name: manifest.version_name },
      },
    });
  } catch (err: any) {
    console.error('[squadhire-callback partner-app installs] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
