import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// shared/src/contentRoles.ts is a synced copy of the same file in Profiles and
// SquadCRM. If this fails, apply the same edit in those repos and update the
// hash in all three content-roles sync tests.
const CONTENT_ROLES_SHA256 = '49031c37eaf91ee30072202e6c8250680088b95e5fe53617c19b7f37fb1e883b';

describe('content roles copy', () => {
  it('matches the copies in Profiles and SquadCRM', () => {
    const file = readFileSync(join(__dirname, '../../../shared/src/contentRoles.ts'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(CONTENT_ROLES_SHA256);
  });
});
