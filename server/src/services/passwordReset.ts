/**
 * Self-serve password reset over WhatsApp.
 *
 * SquadHub had no forgot-password flow at all — an admin had to reset by hand
 * in Supabase. Self-serve (phone → WhatsApp) and admin Users → Reset password
 * now share applyTempPassword(). This mirrors SquadHire's phone-keyed flow
 * (see Profiles backend/src/services/password-reset.service.ts) so a business
 * user who signed in here with their SquadHire credentials meets the same
 * three steps they already know:
 *
 *   1. lookup(phone)  → is this number registered? Returns a MASKED identity
 *                       hint to confirm, plus a signed short-lived reset ticket.
 *   2. send(ticket)   → mint a two-word temp password, apply it to the account
 *                       (forcing a change on next sign-in) and deliver it over
 *                       WhatsApp through Squad CRM.
 *   3. verify(ticket, temp_password) → sign in with the temp password and hand
 *                       back the normal auth payload; the client then routes to
 *                       "set a new password" via the must_reset_password flag.
 *
 * Security: the temp password is never returned to the browser (WhatsApp only);
 * identity hints are masked; the ticket is a signed JWT scoped to one account
 * and expires quickly; lookup/send/verify are rate-limited and verify attempts
 * per ticket are capped (see routes/auth.ts).
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabaseAdmin, supabase } from '../supabase';
import { config } from '../config';

// ─── Phone helpers ───────────────────────────────────────────────────────────
// Numbers are stored however they were entered (+91…, 0…, bare national), so
// matching is on the trailing 10 digits — the same rule SquadHire uses. On this
// side `users.phone_last10` is a generated column (migration 177), so the
// lookup is an indexed equality check rather than a trailing-LIKE scan.

export function normalizePhoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

export function phoneMatchSuffix(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  return digits.slice(-10);
}

// ─── Temp password ───────────────────────────────────────────────────────────
// Two short words joined by a hyphen: far easier to relay over WhatsApp and
// re-type than a random string, and still a short-lived, rate-limited secret.

const TEMP_WORDS: readonly string[] = [
  'able', 'acid', 'aged', 'also', 'area', 'army', 'away', 'baby', 'back', 'ball',
  'band', 'bank', 'base', 'bath', 'bead', 'bean', 'bear', 'beat', 'bell', 'belt',
  'bird', 'blue', 'boat', 'body', 'bolt', 'bone', 'book', 'boot', 'boss', 'bulb',
  'cake', 'calm', 'camp', 'card', 'care', 'cart', 'case', 'cash', 'cell', 'chef',
  'city', 'clay', 'clip', 'club', 'coal', 'coat', 'code', 'coin', 'cold', 'cook',
  'cool', 'copy', 'corn', 'crew', 'crop', 'cube', 'dark', 'dash', 'data', 'date',
  'dawn', 'deer', 'desk', 'dime', 'dish', 'dock', 'door', 'dove', 'draw', 'drum',
  'duck', 'dust', 'earn', 'east', 'easy', 'edge', 'exam', 'face', 'fact', 'fair',
  'fall', 'farm', 'fast', 'fern', 'film', 'find', 'fire', 'fish', 'flag', 'flat',
  'flow', 'fold', 'font', 'food', 'foot', 'fork', 'form', 'fort', 'frog', 'fuel',
  'gain', 'game', 'gate', 'gear', 'gift', 'girl', 'glad', 'glow', 'glue', 'goal',
  'goat', 'gold', 'good', 'gray', 'grid', 'grip', 'hall', 'hand', 'hawk', 'heat',
  'herb', 'hero', 'hill', 'hint', 'home', 'hope', 'horn', 'host', 'hour', 'iron',
  'item', 'jade', 'jazz', 'join', 'jump', 'keen', 'keep', 'kind', 'king', 'kite',
  'lake', 'lamp', 'land', 'lane', 'leaf', 'lens', 'life', 'lime', 'line', 'link',
  'lion', 'list', 'load', 'lock', 'loft', 'main', 'mall', 'mane', 'many', 'mate',
  'mark', 'mask', 'mast', 'meal', 'mesh', 'mild', 'mile', 'mint', 'mode', 'moon',
  'moss', 'moth', 'name', 'navy', 'neat', 'nest', 'news', 'nice', 'node', 'note',
  'oval', 'oath', 'open', 'oven', 'pace', 'pack', 'page', 'palm', 'park', 'path',
  'peak', 'pear', 'peer', 'pine', 'pink', 'plan', 'plot', 'plum', 'poem', 'pond',
  'pool', 'port', 'post', 'pull', 'pure', 'push', 'raft', 'rail', 'rain', 'ramp',
  'rate', 'read', 'reef', 'rest', 'rice', 'ride', 'ring', 'rise', 'road', 'rock',
  'rope', 'rose', 'ruby', 'rule', 'safe', 'sail', 'salt', 'sand', 'save', 'seal',
  'seat', 'seed', 'ship', 'shoe', 'shop', 'show', 'sign', 'silk', 'site', 'size',
  'sky', 'snow', 'soap', 'sofa', 'soft', 'soil', 'song', 'sort', 'soup', 'star',
  'stay', 'stem', 'step', 'stop', 'sure', 'swan', 'take', 'tale', 'tank', 'tape',
  'task', 'team', 'tent', 'tide', 'tile', 'time', 'tone', 'tool', 'tree', 'trip',
  'tube', 'tune', 'turn', 'twin', 'unit', 'vase', 'view', 'vote', 'wall', 'warm',
  'wash', 'wave', 'wide', 'wind', 'wing', 'wise', 'wolf', 'wood', 'wool', 'word',
  'work', 'yard', 'yarn', 'year', 'zinc', 'zone',
];

export function generateWordTempPassword(): string {
  const first = TEMP_WORDS[crypto.randomInt(TEMP_WORDS.length)]!;
  let second = first;
  while (second === first) {
    second = TEMP_WORDS[crypto.randomInt(TEMP_WORDS.length)]!;
  }
  return `${first}-${second}`;
}

// ─── Reset ticket ────────────────────────────────────────────────────────────

const TICKET_TTL_SECONDS = 10 * 60;

interface ResetTicket {
  purpose: 'pwreset';
  sub: string; // SquadHub user id
  phone: string; // trailing-10-digit form the user entered
  jti: string; // per-ticket id, used to cap verify attempts
}

export class PasswordResetError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function issueTicket(sub: string, phone: string): string {
  const payload: ResetTicket = { purpose: 'pwreset', sub, phone, jti: crypto.randomUUID() };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: TICKET_TTL_SECONDS });
}

export function verifyTicket(token: string): ResetTicket {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new PasswordResetError(400, 'This reset session has expired. Please start again.');
  }
  const t = decoded as Partial<ResetTicket>;
  if (t.purpose !== 'pwreset' || !t.sub || !t.phone || !t.jti) {
    throw new PasswordResetError(400, 'Invalid reset session. Please start again.');
  }
  return t as ResetTicket;
}

// Cap guesses per ticket so a two-word temp password can't be brute-forced
// inside its 10-minute window. Bounded and self-cleaning.
const MAX_VERIFY_ATTEMPTS = 5;
const verifyAttempts = new Map<string, { count: number; expires: number }>();

function registerVerifyAttempt(jti: string): void {
  const now = Date.now();
  for (const [key, v] of verifyAttempts) {
    if (v.expires <= now) verifyAttempts.delete(key);
  }
  const entry = verifyAttempts.get(jti) ?? {
    count: 0,
    expires: now + TICKET_TTL_SECONDS * 1000,
  };
  entry.count += 1;
  verifyAttempts.set(jti, entry);
  if (entry.count > MAX_VERIFY_ATTEMPTS) {
    throw new PasswordResetError(429, 'Too many attempts. Please start the reset again.');
  }
}

// ─── Identity masking ────────────────────────────────────────────────────────
// "Rahul Kumar" → "R•••••••••r". Enough to confirm it's the right account
// without disclosing it to someone typing in a number that isn't theirs.

function maskLabel(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v.length <= 2) return `${v[0]}•`;
  const middle = Math.min(v.length - 2, 6);
  return `${v[0]}${'•'.repeat(middle)}${v[v.length - 1]}`;
}

// ─── Step 1: lookup ──────────────────────────────────────────────────────────

export interface LookupResult {
  found: boolean;
  masked_name?: string;
  reset_ticket?: string;
}

export async function lookupAccountByPhone(phone: string): Promise<LookupResult> {
  const last10 = phoneMatchSuffix(phone);
  if (!last10 || last10.length < 10) return { found: false };

  const { data: rows, error } = await supabaseAdmin
    .from('users')
    .select('id, display_name, status')
    .eq('phone_last10', last10)
    .limit(2);

  if (error) {
    console.error('[password-reset] lookup failed:', error.message);
    return { found: false };
  }

  // Only active accounts can reset. Ambiguous matches (the same number on two
  // accounts) are refused rather than guessed at — resetting the wrong one
  // would lock someone out.
  const active = (rows ?? []).filter((r) => r.status === 'active');
  if (active.length !== 1) return { found: false };

  const user = active[0];
  return {
    found: true,
    masked_name: maskLabel(user.display_name),
    reset_ticket: issueTicket(user.id, last10),
  };
}

// ─── Step 2: send ────────────────────────────────────────────────────────────

const CRM_TIMEOUT_MS = 5_000;

/**
 * Fire the Squad CRM system event that maps to the approved WhatsApp template
 * carrying the temp password. Treats a `{skipped:true}` body (no approved
 * template mapped yet) as "accepted but not delivered", so the flow degrades
 * cleanly before the template goes live.
 */
async function deliverTempPasswordWhatsApp(args: {
  name: string | null;
  phone: string;
  tempPassword: string;
}): Promise<boolean> {
  const url = config.squadCrmSystemEventsUrl;
  if (!url) return false;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.squadCrmInboundSecret) {
    headers['X-SquadHire-Admin-Signature'] = config.squadCrmInboundSecret;
  }

  const payload = {
    system_event: 'squadhub_password_reset',
    talent: { name: args.name ?? '', phone: args.phone, email: null },
    data: { talent_name: args.name ?? '', temp_password: args.tempPassword },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CRM_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[password-reset] CRM webhook http_${res.status}`);
      return false;
    }
    try {
      const body = (await res.json()) as { data?: { skipped?: boolean } };
      if (body?.data?.skipped === true) return false;
    } catch {
      // Non-JSON / empty body → treat as a real send.
    }
    return true;
  } catch (err: any) {
    console.warn(`[password-reset] CRM webhook failed: ${String(err?.message).slice(0, 200)}`);
    return false;
  }
}

/**
 * Mint a two-word temp password, apply it to the auth user, and force a
 * change on next sign-in via must_reset_password. Shared by the self-serve
 * WhatsApp flow and the admin Users "Reset password" action.
 */
export async function applyTempPassword(
  userId: string,
): Promise<{ tempPassword: string; email: string }> {
  const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (getErr || !existing?.user?.email) {
    throw new PasswordResetError(400, 'This account has no email on file.');
  }
  const email = existing.user.email;
  const tempPassword = generateWordTempPassword();

  // updateUserById MERGES user_metadata, so this sets the flag without
  // clobbering display_name and friends.
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    user_metadata: { must_reset_password: true },
  });
  if (updErr) throw new PasswordResetError(400, updErr.message);

  // Smoke-test the credential before handing it out, so we never WhatsApp
  // or show an admin a temp password that silently doesn't work.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password: tempPassword,
  });
  if (signInErr) {
    throw new PasswordResetError(500, 'Failed to set a temporary password. Please try again.');
  }
  // Don't leave the smoke-test session sitting on the shared public client.
  await supabase.auth.signOut().catch(() => undefined);

  // The temp password is a live credential — never log it by default. Opt in
  // explicitly for local debugging; must NOT be set in production.
  if (process.env.PASSWORD_RESET_DEBUG === '1') {
    console.log(`[password-reset] temp password for user ${userId}: ${tempPassword}`);
  }

  return { tempPassword, email };
}

export async function sendTempPassword(
  ticketToken: string,
): Promise<{ sent: true; delivered: boolean }> {
  const ticket = verifyTicket(ticketToken);

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, display_name, phone, status')
    .eq('id', ticket.sub)
    .maybeSingle();

  if (!user || user.status !== 'active') {
    throw new PasswordResetError(400, 'This account is no longer available for reset.');
  }

  const { tempPassword } = await applyTempPassword(ticket.sub);

  const delivered = user.phone
    ? await deliverTempPasswordWhatsApp({
        name: user.display_name ?? null,
        phone: user.phone,
        tempPassword,
      })
    : false;

  return { sent: true, delivered };
}

// ─── Step 3: verify ──────────────────────────────────────────────────────────

export async function verifyTempPassword(ticketToken: string, tempPassword: string) {
  const ticket = verifyTicket(ticketToken);
  registerVerifyAttempt(ticket.jti);

  const candidate = tempPassword.trim().toLowerCase();

  const { data: existing } = await supabaseAdmin.auth.admin.getUserById(ticket.sub);
  const email = existing?.user?.email;
  if (!email) throw new PasswordResetError(400, 'This account has no email on file.');

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: candidate,
  });
  if (error || !data.session) {
    throw new PasswordResetError(401, 'Incorrect temporary password. Please check and try again.');
  }

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', ticket.sub)
    .maybeSingle();

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    must_reset_password: true,
    user: profile ?? { id: data.user.id, email },
  };
}
