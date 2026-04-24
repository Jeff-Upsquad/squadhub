import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../../config';
import { supabaseAdmin } from '../../supabase';

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
            status,
            responded_at: body.responded_at,
          },
          { onConflict: 'card_id,external_system,external_recipient_id' },
        );
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
      console.error('[squadhire-callback] error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

export default router;
