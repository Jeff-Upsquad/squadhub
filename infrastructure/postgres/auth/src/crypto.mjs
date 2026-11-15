import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function hashPassword(password) {
  // Supabase's existing bcrypt hashes can be verified without resetting users.
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
    throw Object.assign(new Error('Password must be at least 8 characters and at most 72 bytes'), { status: 422 });
  }
  return bcrypt.hash(password, 12);
}
const dummyHash = bcrypt.hashSync('unavailable-account-password', 12);
export async function verifyPassword(password, hash) {
  const supported = typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);
  // Always do password work, including nonexistent accounts, to reduce enumeration.
  const candidate = typeof password === 'string' && Buffer.byteLength(password) <= 72 ? password : '';
  const ok = await bcrypt.compare(candidate, supported ? hash.replace(/^\$2y\$/, '$2b$') : dummyHash);
  return supported && candidate.length > 0 && ok;
}
export function signAccess(user, sessionId, config) {
  return jwt.sign({ role: 'authenticated', email: user.email, session_id: sessionId,
    aal: 'aal1', app_metadata: user.raw_app_meta_data || {}, user_metadata: user.raw_user_meta_data || {} },
  config.jwtSecret, { algorithm: 'HS256', issuer: config.issuer, audience: 'authenticated',
    subject: user.id, expiresIn: config.accessSeconds });
}
export function verifyAccess(token, config) {
  const claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: config.issuer, audience: 'authenticated' });
  if (!claims || typeof claims === 'string' || claims.role !== 'authenticated' ||
      !/^[0-9a-f-]{36}$/i.test(claims.sub || '') || !/^[0-9a-f-]{36}$/i.test(claims.session_id || '')) {
    throw Object.assign(new Error('Invalid session'), { status: 401 });
  }
  return claims;
}
