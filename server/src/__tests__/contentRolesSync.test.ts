import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// shared/src/contentRoles.ts is a synced copy of the same file in Profiles and
// SquadCRM. If this fails, apply the same edit in those repos and update the
// hash in all three content-roles sync tests.
const CONTENT_ROLES_SHA256 = 'e8221a01cae1ea4d8ba98c8289b91156cca956d782a4b4ac52f0499c4b2297a2';

describe('content roles copy', () => {
  it('matches the copies in Profiles and SquadCRM', () => {
    const file = readFileSync(join(__dirname, '../../../shared/src/contentRoles.ts'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(CONTENT_ROLES_SHA256);
  });
});
