#!/usr/bin/env node
import { randomBytes, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const secret=()=>randomBytes(48).toString('hex');
const jwtSecret=secret(), issuer='squadhub-local-identity';
function key(role) {
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:issuer,aud:'authenticated',role,
    iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+10*365*86400})).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256',jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
}
const values={LOCAL_POSTGRES_DB:'squadhub',LOCAL_POSTGRES_PASSWORD:secret(),
  LOCAL_AUTHENTICATOR_PASSWORD:secret(),LOCAL_IDENTITY_PASSWORD:secret(),LOCAL_JWT_SECRET:jwtSecret,
  LOCAL_AUTH_ISSUER:issuer,LOCAL_ANON_KEY:key('anon'),LOCAL_SERVICE_ROLE_KEY:key('service_role'),IDENTITY_RATE_LIMIT_SECRET:secret()};
const target=process.argv[2] || fileURLToPath(new URL('.env',import.meta.url));
writeFileSync(target,Object.entries(values).map(([k,v])=>`${k}=${v}\n`).join(''),{mode:0o600,flag:'wx'});
console.log('Created private environment file. Existing credentials are never overwritten.');
