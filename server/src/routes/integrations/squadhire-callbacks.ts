import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../../config';
import { supabaseAdmin } from '../../supabase';
import { logCardEvent } from '../../utils/cardEvents';
import {
  ensureActiveAssignmentTerm,
  endActiveAssignmentTermsForCard,
} from '../../utils/assignmentTerms';

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

      // Close the card
      await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'closed',
          closed_at: now,
          selected_recipient_type: 'talent',
          selected_recipient_id: body.talent_user_id,
        })
        .eq('id', card.id);

      // Open the billing ledger term so this engagement shows in the Active
      // Subscriptions view (payments + hours). The card is "closed" only in the
      // sense of being removed from the open offer pool — the talent is now the
      // chosen recipient, so the term starts active. Best-effort (non-fatal).
      await ensureActiveAssignmentTerm({
        cardId: card.id,
        recipientType: 'talent',
        recipientId: body.talent_user_id,
        recipientName: body.talent_name ?? null,
        assignedDate: now,
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

export default router;
