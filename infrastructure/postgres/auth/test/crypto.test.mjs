import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { equalSecret, hashPassword, verifyPassword, signAccess, verifyAccess, tokenHash } from '../src/crypto.mjs';

test('password hashes are compatible and long passwords cannot silently truncate',async()=>{
  const hash=await hashPassword('a secure password');
  assert.equal(await verifyPassword('a secure password',hash),true);
  assert.equal(await verifyPassword('wrong password',hash),false);
  assert.equal(await verifyPassword('anything',null),false);
  await assert.rejects(hashPassword('x'.repeat(73)),/72 bytes/);
  assert.equal(await verifyPassword('a'.repeat(73),hash),false);
});
test('JWT verification binds issuer, audience, algorithm and session identity',()=>{
  const config={jwtSecret:'testing-key-'.repeat(8),issuer:'local-test',accessSeconds:900};
  const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.com'};
  const sid='22222222-2222-4222-8222-222222222222';
  const token=signAccess(user,sid,config);
  assert.equal(verifyAccess(token,config).session_id,sid);
  assert.throws(()=>verifyAccess(token,{...config,issuer:'other'}));
  assert.throws(()=>verifyAccess(jwt.sign({role:'service_role'},config.jwtSecret),config));
  assert.throws(()=>verifyAccess(token.slice(0,-2)+'xx',config));
});
test('opaque credentials are compared safely and stored as hashes',()=>{
  assert.equal(equalSecret('one','one'),true);
  assert.equal(equalSecret('one','two'),false);
  assert.equal(equalSecret(undefined,'one'),false);
  assert.equal(tokenHash('token').length,64);
  assert.notEqual(tokenHash('token'),tokenHash('other'));
});
