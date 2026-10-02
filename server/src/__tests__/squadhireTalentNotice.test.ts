import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { TALENT_NOTICE_KINDS, talentNoticeSchema } from '../utils/squadhireTalentNotice';

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations');

// The newest migration that redefines notifications_type_check is the live
// allowlist — every notice kind lands verbatim in notifications.type.
function latestNotificationTypes(): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().reverse();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const check = sql.match(/ADD CONSTRAINT notifications_type_check CHECK \(([\s\S]*?)\)\s*;/);
    if (check) return new Set([...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  }
  throw new Error('no migration defines notifications_type_check');
}

const notice = (kind: string) => ({
  kind,
  title: 'Your UpSquad Partner Program application is restored',
  body: 'Your application has been restored. Continue your onboarding to get started.',
  route: '/notifications',
  emails: ['talent@example.com'],
});

describe('squadhire talent notice', () => {
  it.each(TALENT_NOTICE_KINDS)('accepts %s', (kind) => {
    expect(talentNoticeSchema.parse(notice(kind)).kind).toBe(kind);
  });

  it('rejects an unknown kind', () => {
    expect(talentNoticeSchema.safeParse(notice('application_paused')).success).toBe(false);
  });

  it('allows every notice kind in notifications_type_check', () => {
    const allowed = latestNotificationTypes();
    expect(TALENT_NOTICE_KINDS.filter((k) => !allowed.has(k))).toEqual([]);
  });
});
