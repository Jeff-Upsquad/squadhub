import { supabaseAdmin } from '../supabase';
import { lookupSquadhireUsers } from './squadhireLookup';

/**
 * Cross-system bridge: SquadHub `users.user_type='partner_employee'` ↔ SquadHire's
 * separate `talent_users` table. SquadHire stores its own user UUIDs and never
 * sees our `user_type`, so on the SquadHub side we walk:
 *
 *   users WHERE user_type='partner_employee' → emails → SquadHire lookup → talent_user_ids
 *
 * `lookupSquadhireUsers` already has a 2-min cache, so callers can hit these
 * helpers per-request without flooding SquadHire.
 *
 * Best-effort: a partner-employee whose SquadHub email doesn't match a
 * SquadHire account (or vice versa) will silently fall outside the set.
 */

interface PartnerEmployeeRow {
  id: string;
  email: string;
}

async function loadPartnerEmployees(): Promise<PartnerEmployeeRow[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .eq('user_type', 'partner_employee')
    .eq('status', 'active')
    .not('email', 'is', null);
  if (error) {
    console.error('[partnerEmployeeSquadhireIds] load failed:', error.message);
    return [];
  }
  return (data || [])
    .map((u: any): PartnerEmployeeRow | null => {
      const email = typeof u.email === 'string' ? u.email.trim() : '';
      if (!email) return null;
      return { id: u.id as string, email };
    })
    .filter((r): r is PartnerEmployeeRow => r !== null);
}

/**
 * Returns the set of SquadHire talent_user_ids that correspond to active
 * SquadHub partner-employees. Used to mark recipient list rows so the UI
 * can show an Auto-accept button on the right rows.
 */
export async function getPartnerEmployeeSquadhireIds(): Promise<Set<string>> {
  const employees = await loadPartnerEmployees();
  if (employees.length === 0) return new Set();

  const matches = await lookupSquadhireUsers(employees.map((e) => e.email));
  const ids = new Set<string>();
  for (const match of matches.values()) {
    ids.add(match.talent_user_id);
  }
  return ids;
}

/**
 * Reverse single-talent lookup: given a SquadHire talent_user_id, return the
 * matching SquadHub partner-employee (id + email), or null. Used by the
 * auto-accept-talent endpoint as the authority gate before flipping
 * subscription_card_external_recipients to accepted on behalf of someone.
 */
export async function findPartnerEmployeeByTalentId(
  talentId: string,
): Promise<{ id: string; email: string } | null> {
  const employees = await loadPartnerEmployees();
  if (employees.length === 0) return null;

  const matches = await lookupSquadhireUsers(employees.map((e) => e.email));
  for (const [email, match] of matches) {
    if (match.talent_user_id === talentId) {
      const matched = employees.find((e) => e.email.toLowerCase() === email.toLowerCase());
      if (matched) return { id: matched.id, email: matched.email };
    }
  }
  return null;
}
