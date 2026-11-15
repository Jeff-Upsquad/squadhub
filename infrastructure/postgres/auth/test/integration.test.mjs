import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../src/service.mjs';
import { tokenHash } from '../src/crypto.mjs';

const url=process.env.TEST_DATABASE_URL;
const config={jwtSecret:'identity-test-key-'.repeat(6),issuer:'squadhub-identity-test',anonKey:'test-anon-key',
  serviceKey:'test-service-key',rateLimitSecret:'rate-limit-test-secret-'.repeat(3),accessSeconds:900,refreshSeconds:86400,
  publicUrl:'http://127.0.0.1',redirectUrls:['http://localhost/accept-invite']};
let pool,server,base,admin;
before(async()=>{
  if(!url)return;
  if(new URL(url).pathname!=='/squadhub_identity_test')throw new Error('Tests require the isolated squadhub_identity_test database');
  pool=new pg.Pool({connectionString:url,max:5});
  assert.equal((await pool.query('select current_database() as name')).rows[0].name,'squadhub_identity_test');
  await pool.query('DROP SCHEMA IF EXISTS hub_identity CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE public.users (id uuid PRIMARY KEY, status text);');
  await pool.query(await readFile(process.env.BOOTSTRAP_SQL || new URL('../../bootstrap.sql',import.meta.url),'utf8'));
  await pool.query('ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY; ALTER TABLE public.users ENABLE ROW LEVEL SECURITY');
  const app=createApp(pool,config);
  // SDK compatibility is tested through its normal /auth/v1 prefix.
  const express=(await import('express')).default;
  const outer=express();outer.use('/auth/v1',app);
  server=outer.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  config.publicUrl=base+'/auth/v1';
  admin=createClient(base,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();});
const it=(name,fn)=>test(name,{skip:!url},fn);
const api=async(path,body,token=config.serviceKey,method='POST')=>{
  const r=await fetch(`${base}/auth/v1${path}`,{method,headers:{apikey:config.anonKey,authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:r.status===204?null:await r.json()};
};
async function account(label){
  const email=`${label}@example.com`,password='correct-horse-battery';
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:label}});
  assert.equal(error,null);assert.equal(data.user.email,email);
  await pool.query('INSERT INTO public.users(id,status) VALUES($1,$2)',[data.user.id,'active']);
  return {id:data.user.id,email,password};
}
const login=async u=>{const r=await api('/token?grant_type=password',{email:u.email,password:u.password});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};

it('public callers cannot create users or mint SSO credentials',async()=>{
  assert.equal((await api('/signup',{email:'uninvited@example.com',password:'uninvited-password'},config.anonKey)).status,403);
  assert.equal((await api('/admin/users',{},config.anonKey)).status,403);
  assert.equal((await api('/admin/generate_link',{},config.anonKey)).status,403);
  const r=await fetch(`${base}/auth/v1/admin/users`,{headers:{authorization:`Bearer ${config.serviceKey}`}});
  assert.equal(r.status,401);
});
it('existing SDK supports user creation, password login, getUser and paginated listing',async()=>{
  const u=await account('sdk');
  const client=createClient(base,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.signInWithPassword({email:u.email,password:u.password});
  assert.equal(error,null);assert.equal(data.user.id,u.id);assert.ok(data.session.access_token);
  const verified=await client.auth.getUser(data.session.access_token);
  assert.equal(verified.error,null);assert.equal(verified.data.user.id,u.id);
  const listed=await admin.auth.admin.listUsers({page:1,perPage:1});
  assert.equal(listed.error,null);assert.equal(listed.data.users.length,1);
  const lookup=await admin.auth.admin.getUserById(u.id);assert.equal(lookup.data.user.id,u.id);
});
it('bad passwords, inactive profiles and expired sessions fail closed',async()=>{
  const u=await account('inactive');
  assert.equal((await api('/token?grant_type=password',{email:u.email,password:'incorrect'})).status,400);
  const session=await login(u);
  await pool.query("UPDATE public.users SET status='suspended' WHERE id=$1",[u.id]);
  assert.equal((await api('/user',undefined,session.access_token,'GET')).status,403);
  assert.equal((await api('/token?grant_type=refresh_token',{refresh_token:session.refresh_token})).status,403);
  await pool.query("UPDATE public.users SET status='active' WHERE id=$1",[u.id]);
  await pool.query("UPDATE hub_identity.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[u.id]);
  assert.equal((await api('/user',undefined,session.access_token,'GET')).status,401);
});
it('refresh rotation is atomic and raw refresh credentials never persist',async()=>{
  const u=await account('refresh'),session=await login(u);
  const responses=await Promise.all([1,2].map(()=>api('/token?grant_type=refresh_token',{refresh_token:session.refresh_token})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
  const rotated=responses.find(r=>r.status===200).body;
  assert.notEqual(rotated.refresh_token,session.refresh_token);
  const {rows}=await pool.query('SELECT refresh_hash FROM hub_identity.sessions WHERE user_id=$1',[u.id]);
  assert.equal(rows[0].refresh_hash,tokenHash(rotated.refresh_token));
  assert.notEqual(rows[0].refresh_hash,rotated.refresh_token);
});
it('logout revokes access immediately, including the PostgREST pre-request gate',async()=>{
  const u=await account('logout'),session=await login(u);
  const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
  const check=async()=>{
    const db=await pool.connect();
    try{await db.query('BEGIN');await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('app.settings.jwt_issuer',$2,true)",[JSON.stringify(claims),config.issuer]);await db.query('SET LOCAL ROLE authenticated');await db.query('SELECT hub_identity.check_session()');}
    finally{await db.query('ROLLBACK');db.release();}
  };
  await check();
  assert.equal((await api('/logout?scope=global',{},session.access_token)).status,204);
  assert.equal((await api('/user',undefined,session.access_token,'GET')).status,401);
  await assert.rejects(check(),error=>error.code==='PT401');
});
it('password resets preserve metadata and revoke sessions and outstanding SSO tickets',async()=>{
  const u=await account('reset'),session=await login(u);
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:u.email});assert.equal(link.error,null);
  const changed=await admin.auth.admin.updateUserById(u.id,{password:'changed-password',user_metadata:{must_reset_password:true}});
  assert.equal(changed.error,null);assert.equal(changed.data.user.user_metadata.display_name,'reset');
  assert.equal((await api('/user',undefined,session.access_token,'GET')).status,401);
  assert.equal((await api('/verify',{type:'magiclink',token_hash:link.data.properties.hashed_token})).status,400);
  assert.equal((await api('/token?grant_type=password',{email:u.email,password:u.password})).status,400);
  const next=await login({...u,password:'changed-password'});assert.equal(next.user.user_metadata.must_reset_password,true);
});
it('SSO SDK handoff is one use and deleting users revokes their credentials',async()=>{
  const u=await account('sso');
  const link=await admin.auth.admin.generateLink({type:'magiclink',email:u.email});assert.equal(link.error,null);
  const stored=await pool.query('SELECT token_hash FROM hub_identity.login_tickets WHERE user_id=$1',[u.id]);
  assert.equal(stored.rows[0].token_hash,tokenHash(link.data.properties.hashed_token));
  assert.notEqual(stored.rows[0].token_hash,link.data.properties.hashed_token);
  assert.equal((await api('/verify',{type:'magiclink',token_hash:stored.rows[0].token_hash})).status,400);
  const client=createClient(base,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const otp={type:'magiclink',token_hash:link.data.properties.hashed_token};
  const {data,error}=await client.auth.verifyOtp(otp);assert.equal(error,null);assert.equal(data.user.id,u.id);
  assert.equal((await api('/verify',otp)).status,400);
  await pool.query('DELETE FROM public.users WHERE id=$1',[u.id]);
  assert.equal((await admin.auth.admin.deleteUser(u.id)).error,null);
  assert.equal((await api('/user',undefined,data.session.access_token,'GET')).status,401);
});
it('shared admin-created identities work without inventing a Hub profile',async()=>{
  const u=await account('orphan'),session=await login(u);
  const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
  await pool.query('DELETE FROM public.users WHERE id=$1',[u.id]);
  assert.equal((await api('/user',undefined,session.access_token,'GET')).status,200);
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('app.settings.jwt_issuer',$2,true)",[JSON.stringify(claims),config.issuer]);
    await db.query('SET LOCAL ROLE authenticated');
    await db.query('SELECT hub_identity.check_session()');
  }finally{await db.query('ROLLBACK');db.release();}
});
it('self-service password changes retain the caller but revoke other sessions',async()=>{
  const u=await account('self-reset'),first=await login(u),other=await login(u);
  const changed=await api('/user',{password:'self-service-changed',data:{must_reset_password:false}},first.access_token,'PUT');
  assert.equal(changed.status,200);
  assert.equal((await api('/user',undefined,first.access_token,'GET')).status,200);
  assert.equal((await api('/user',undefined,other.access_token,'GET')).status,401);
  assert.equal((await api('/user',{app_metadata:{role:'admin'}},first.access_token,'PUT')).status,422);
});
it('private session tables are inaccessible to API roles',async()=>{
  for(const role of ['anon','authenticated','service_role']){
    const {rows}=await pool.query("SELECT has_table_privilege($1,'hub_identity.sessions','SELECT') AS allowed",[role]);
    assert.equal(rows[0].allowed,false);
  }
});
it('admin invitation links confirm once, reject open redirects and support SDK password setup',async()=>{
  const email='invited@example.com';
  const wrong=await admin.auth.admin.generateLink({type:'invite',email,options:{redirectTo:'https://evil.example/steal'}});
  assert.ok(wrong.error);
  const generated=await admin.auth.admin.generateLink({type:'invite',email,options:{redirectTo:config.redirectUrls[0],data:{display_name:'Invited'}}});
  assert.equal(generated.error,null);
  const {user,properties}=generated.data;assert.equal(user.email,email);assert.ok(properties.action_link);
  assert.equal(user.email_confirmed_at,null);
  await pool.query('INSERT INTO public.users(id,status) VALUES($1,$2)',[user.id,'active']);
  const response=await fetch(properties.action_link,{redirect:'manual'});assert.equal(response.status,303);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const location=new URL(response.headers.get('location'));assert.equal(location.origin+location.pathname,config.redirectUrls[0]);
  const fragment=new URLSearchParams(location.hash.slice(1));
  const client=createClient(base,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  assert.equal((await client.auth.setSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')})).error,null);
  const updated=await client.auth.updateUser({password:'invitation-password'});assert.equal(updated.error,null);
  assert.equal((await fetch(properties.action_link,{redirect:'manual'})).status,400);
  await login({email,password:'invitation-password'});
});
