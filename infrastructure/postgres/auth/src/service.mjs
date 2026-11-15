import { randomUUID } from 'node:crypto';
import express from 'express';
import { equalSecret, hashPassword, opaqueToken, signAccess, tokenHash, verifyAccess, verifyPassword } from './crypto.mjs';

const fail = (status, message, code = 'request_failed') => { throw Object.assign(new Error(message), { status, code }); };
const blocked = new Set(['pending', 'rejected', 'banned', 'suspended']);
const normalizeEmail = value => {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(422, 'A valid email is required');
  return value.trim().toLowerCase();
};
const metadata = value => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || JSON.stringify(value).length > 16384) fail(422, 'Invalid user metadata');
  return value;
};
export const publicUser = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
  email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at,
  created_at: u.created_at, updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at,
  app_metadata: u.raw_app_meta_data || {}, user_metadata: u.raw_user_meta_data || {}, identities: [] });

export function createApp(pool, config) {
  if (!config.jwtSecret || config.jwtSecret.length < 48 || !config.anonKey || !config.serviceKey ||
      !config.issuer || !config.rateLimitSecret || config.rateLimitSecret.length < 32) throw new Error('Identity configuration is incomplete');
  for(const value of [config.publicUrl,...(config.redirectUrls || [])].filter(Boolean)){
    const url=new URL(value);
    if(url.username || url.password || url.hash || (url.protocol!=='https:' &&
      !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('Identity links require HTTPS or a loopback trial URL');
  }
  const app = express();
  app.disable('x-powered-by');
  // Gateway supplies one trusted X-Forwarded-For hop; identity has no host port.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '24kb' }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy','no-referrer'); next(); });
  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.use((req, _res, next) => {
    if(req.method==='GET' && req.path==='/verify') { next(); return; }
    if (!equalSecret(req.get('apikey'), config.anonKey) && !equalSecret(req.get('apikey'), config.serviceKey)) fail(401, 'Invalid API key');
    next();
  });
  const admin = (req, _res, next) => {
    if (!equalSecret(req.get('authorization'), `Bearer ${config.serviceKey}`)) fail(403, 'Administrator credentials required');
    next();
  };
  const transaction = async fn => {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  };
  const rateLimit = async (req, purpose) => {
    const ip = tokenHash(`${config.rateLimitSecret}:${req.ip || 'unknown'}:${purpose}`);
    const { rows } = await pool.query(`INSERT INTO hub_identity.rate_limits (key, attempts, reset_at)
      VALUES ($1, 1, now() + interval '15 minutes') ON CONFLICT (key) DO UPDATE SET
      attempts=CASE WHEN hub_identity.rate_limits.reset_at < now() THEN 1 ELSE hub_identity.rate_limits.attempts+1 END,
      reset_at=CASE WHEN hub_identity.rate_limits.reset_at < now() THEN now()+interval '15 minutes' ELSE hub_identity.rate_limits.reset_at END
      RETURNING attempts`, [ip]);
    if (rows[0].attempts > 30) fail(429, 'Too many attempts. Try again later.', 'over_request_rate_limit');
  };
  const userById = async (db, id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) fail(404, 'User not found');
    const { rows } = await db.query('SELECT * FROM auth.users WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!rows[0]) fail(404, 'User not found');
    return rows[0];
  };
  const allowed = async (db, user) => {
    if (user.deleted_at || (user.banned_until && new Date(user.banned_until) > new Date())) fail(401, 'Account unavailable');
    const { rows } = await db.query('SELECT hub_identity.account_status($1) AS status', [user.id]);
    // Identity is shared with sibling products (e.g. SMM). A confirmed account
    // created by an administrator need not have a Hub profile. Each app still
    // provisions and authorizes its own users; existing blocked Hub profiles
    // remain blocked across the shared identity service.
    if (blocked.has(rows[0]?.status)) fail(403, 'Account is not active', 'account_not_active');
  };
  const sessionResponse = (user, sessionId, refresh) => ({ access_token: signAccess(user, sessionId, config),
    token_type: 'bearer', expires_in: config.accessSeconds, expires_at: Math.floor(Date.now()/1000)+config.accessSeconds,
    refresh_token: refresh, user: publicUser(user) });
  const newSession = async (db, user) => {
    const id = randomUUID(), refresh = opaqueToken();
    await db.query(`INSERT INTO hub_identity.sessions (id,user_id,refresh_hash,expires_at)
      VALUES ($1,$2,$3,now()+($4::int * interval '1 second'))`, [id,user.id,tokenHash(refresh),config.refreshSeconds]);
    await db.query('UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1',[user.id]);
    return sessionResponse(user,id,refresh);
  };
  const currentSession = async req => {
    let claims;
    try { claims=verifyAccess((req.get('authorization') || '').replace(/^Bearer /,''), config); }
    catch { fail(401, 'Invalid or expired session', 'bad_jwt'); }
    const { rows } = await pool.query(`SELECT user_id FROM hub_identity.sessions WHERE id=$1 AND user_id=$2
      AND revoked_at IS NULL AND expires_at > now()`, [claims.session_id,claims.sub]);
    if (!rows[0]) fail(401, 'Session expired', 'session_not_found');
    const user = await userById(pool,claims.sub); await allowed(pool,user);
    return { user, claims };
  };
  const redeemTicket=async(hash,kind)=>transaction(async db=>{
    const {rows}=await db.query(`DELETE FROM hub_identity.login_tickets WHERE token_hash=$1
      AND kind=$2 AND expires_at>now() RETURNING user_id,redirect_to`,[tokenHash(hash),kind]);
    if(!rows[0])fail(400,'Login ticket expired or already used','otp_expired');
    if(kind==='invite')await db.query('UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now() WHERE id=$1',[rows[0].user_id]);
    const user=await userById(db,rows[0].user_id);await allowed(db,user);
    return {session:await newSession(db,user),redirectTo:rows[0].redirect_to};
  });

  app.post('/signup', (_req,_res) => fail(403,'Accounts must be created or invited by an administrator','signup_disabled'));
  app.post('/token', async (req,res) => {
    await rateLimit(req,'token');
    if (req.query.grant_type === 'password') {
      const email=normalizeEmail(req.body.email);
      const { rows } = await pool.query('SELECT * FROM auth.users WHERE lower(email)=$1 AND deleted_at IS NULL',[email]);
      const user=rows[0];
      if (!await verifyPassword(req.body.password,user?.encrypted_password)) fail(400,'Invalid login credentials','invalid_credentials');
      if (!user.email_confirmed_at) fail(400,'Email is not confirmed','email_not_confirmed');
      const result = await transaction(async db => {
        // Serialize password changes with sign-in so an old password cannot mint
        // a fresh session after an administrative reset has committed.
        const {rows: locked}=await db.query('SELECT * FROM auth.users WHERE id=$1 FOR UPDATE',[user.id]);
        if (!locked[0] || locked[0].encrypted_password !== user.encrypted_password) fail(400,'Invalid login credentials','invalid_credentials');
        await allowed(db,locked[0]); return newSession(db,locked[0]);
      });
      res.json(result); return;
    }
    if (req.query.grant_type === 'refresh_token') {
      if (typeof req.body.refresh_token !== 'string' || req.body.refresh_token.length > 256) fail(400,'Invalid refresh token');
      const result = await transaction(async db => {
        const hash=tokenHash(req.body.refresh_token);
        const {rows}=await db.query(`SELECT * FROM hub_identity.sessions WHERE refresh_hash=$1
          AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,[hash]);
        const s=rows[0]; if (!s) return null;
        const user=await userById(db,s.user_id); await allowed(db,user);
        const refresh=opaqueToken();
        await db.query('UPDATE hub_identity.sessions SET refresh_hash=$1 WHERE id=$2',[tokenHash(refresh),s.id]);
        return sessionResponse(user,s.id,refresh);
      });
      if (!result) fail(400,'Refresh token is invalid or already used','refresh_token_not_found');
      res.json(result); return;
    }
    fail(400,'Unsupported grant type');
  });
  app.get('/user', async (req,res) => res.json(publicUser((await currentSession(req)).user)));
  app.put('/user', async (req,res) => {
    const {user,claims}=await currentSession(req);
    if (req.body.email!==undefined || req.body.app_metadata!==undefined) fail(422,'Use administrator account management for this change');
    const password=req.body.password===undefined?undefined:await hashPassword(req.body.password);
    const result=await transaction(async db=>{
      const {rows}=await db.query('SELECT * FROM auth.users WHERE id=$1 FOR UPDATE',[user.id]);
      const latest=rows[0];await allowed(db,latest);
      // Re-check under the user lock: an admin reset may have revoked the
      // caller while its new password was being hashed.
      const active=await db.query('SELECT id FROM hub_identity.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()',[claims.session_id]);
      if(!active.rows[0])fail(401,'Session expired');
      const meta=req.body.data===undefined?latest.raw_user_meta_data:{...latest.raw_user_meta_data,...metadata(req.body.data)};
      const updated=await db.query('UPDATE auth.users SET encrypted_password=coalesce($2,encrypted_password),raw_user_meta_data=$3,updated_at=now() WHERE id=$1 RETURNING *',[user.id,password??null,meta]);
      if(password!==undefined){
        await db.query('UPDATE hub_identity.sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2',[user.id,claims.session_id]);
        await db.query('DELETE FROM hub_identity.login_tickets WHERE user_id=$1',[user.id]);
      }
      return updated.rows[0];
    });res.json(publicUser(result));
  });
  app.post('/logout', async (req,res) => {
    const {user,claims}=await currentSession(req);
    const scope=req.query.scope || 'global';
    if (!['global','local','others'].includes(scope)) fail(400,'Invalid logout scope');
    if (scope==='global') await pool.query('UPDATE hub_identity.sessions SET revoked_at=now() WHERE user_id=$1',[user.id]);
    else await pool.query(`UPDATE hub_identity.sessions SET revoked_at=now() WHERE user_id=$1 AND id ${scope==='others'?'<>':'='} $2`,[user.id,claims.session_id]);
    res.status(204).end();
  });
  // Only admins mint SSO or invitation tickets. Public signup / OTP sending is disabled.
  app.post('/admin/generate_link',admin, async (req,res) => {
    if (!['magiclink','invite'].includes(req.body.type)) fail(400,'Unsupported link type');
    const email=normalizeEmail(req.body.email);
    if(req.body.type==='invite'){
      const redirectTo=typeof req.query.redirect_to==='string'?req.query.redirect_to:(req.body.redirect_to || req.body.redirectTo);
      if(!config.publicUrl || !config.redirectUrls?.includes(redirectTo))fail(422,'Invitation redirect is not configured or allowed');
      const password=await hashPassword(opaqueToken());
      const token=tokenHash(opaqueToken());
      const user=await transaction(async db=>{
        const {rows}=await db.query(`INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,invited_at,
          raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
          VALUES($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,now(),$4,$5,now(),now(),'','','','') RETURNING *`,
          [randomUUID(),email,password,{provider:'email',providers:['email']},req.body.data?metadata(req.body.data):{}]);
        await db.query(`INSERT INTO hub_identity.login_tickets(token_hash,user_id,expires_at,kind,redirect_to)
          VALUES($1,$2,now()+interval '24 hours','invite',$3)`,[tokenHash(token),rows[0].id,redirectTo]);
        return rows[0];
      });
      const action=new URL(config.publicUrl.replace(/\/$/,'')+'/verify');action.searchParams.set('token_hash',token);action.searchParams.set('type','invite');
      res.json({...publicUser(user),hashed_token:token,action_link:action.href,email_otp:'',verification_type:'invite',redirect_to:redirectTo});
      return;
    }
    const {rows}=await pool.query('SELECT * FROM auth.users WHERE lower(email)=$1 AND deleted_at IS NULL',[email]);
    const user=rows[0]; if (!user) fail(404,'User not found'); await allowed(pool,user);
    // `hashed_token` is the SDK's wire field name, but it is still a bearer
    // credential. Store a SECOND hash so a leaked ticket row cannot be redeemed.
    const token=tokenHash(opaqueToken()), hash=tokenHash(token);
    await pool.query(`INSERT INTO hub_identity.login_tickets (token_hash,user_id,expires_at)
      VALUES ($1,$2,now()+interval '60 seconds')`,[hash,user.id]);
    res.json({...publicUser(user),hashed_token:token,action_link:'',email_otp:'',verification_type:'magiclink',redirect_to:''});
  });
  app.post('/verify', async (req,res) => {
    await rateLimit(req,'verify');
    if (req.body.type !== 'magiclink' || !/^[a-f0-9]{64}$/.test(req.body.token_hash || '')) fail(400,'Invalid login ticket');
    const result=await redeemTicket(req.body.token_hash,'magiclink');res.json(result.session);
  });
  app.get('/verify',async(req,res)=>{
    await rateLimit(req,'invite');
    if(req.query.type!=='invite' || !/^[a-f0-9]{64}$/.test(req.query.token_hash || ''))fail(400,'Invalid invitation');
    const result=await redeemTicket(req.query.token_hash,'invite');
    if(!config.redirectUrls?.includes(result.redirectTo))fail(400,'Invitation redirect is no longer allowed');
    const redirect=new URL(result.redirectTo);
    redirect.hash=new URLSearchParams({access_token:result.session.access_token,refresh_token:result.session.refresh_token,
      expires_in:String(config.accessSeconds),token_type:'bearer',type:'invite'}).toString();
    res.redirect(303,redirect.href);
  });
  app.get('/admin/users',admin, async (req,res) => {
    const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1));
    const perPage=Math.max(1,Math.min(1000,Number.parseInt(req.query.per_page,10)||50));
    const {rows}=await pool.query('SELECT * FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT $1 OFFSET $2',[perPage,(page-1)*perPage]);
    const count=await pool.query('SELECT count(*)::int AS count FROM auth.users WHERE deleted_at IS NULL');
    res.json({users:rows.map(publicUser),aud:'authenticated',total:count.rows[0].count,next_page:rows.length===perPage?page+1:null,last_page:Math.ceil(count.rows[0].count/perPage)});
  });
  app.get('/admin/users/:id',admin, async (req,res) => res.json(publicUser(await userById(pool,req.params.id))));
  app.post('/admin/users',admin, async (req,res) => {
    const email=normalizeEmail(req.body.email), hash=await hashPassword(req.body.password || opaqueToken());
    const {rows}=await pool.query(`INSERT INTO auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
      VALUES ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,$3,
      CASE WHEN $4 THEN now() ELSE NULL END,$5,$6,now(),now(),'','','','') RETURNING *`,
    [randomUUID(),email,hash,req.body.email_confirm===true,{provider:'email',providers:['email']},req.body.user_metadata?metadata(req.body.user_metadata):{}]);
    res.status(201).json(publicUser(rows[0]));
  });
  app.put('/admin/users/:id',admin, async (req,res) => {
    const password=req.body.password===undefined?undefined:await hashPassword(req.body.password);
    const email=req.body.email===undefined?undefined:normalizeEmail(req.body.email);
    const result=await transaction(async db => {
      const user=await userById(db,req.params.id);
      // Consistent lock order with sign-in; prevent concurrent metadata updates being lost.
      const {rows: locked}=await db.query('SELECT * FROM auth.users WHERE id=$1 FOR UPDATE',[user.id]);
      const latest=locked[0];
      const set=[],args=[user.id];
      const add=(column,value)=>{args.push(value);set.push(`${column}=$${args.length}`);};
      if (password!==undefined) add('encrypted_password',password);
      if (email!==undefined) add('email',email);
      if (req.body.user_metadata!==undefined) add('raw_user_meta_data',{...latest.raw_user_meta_data,...metadata(req.body.user_metadata)});
      if (req.body.app_metadata!==undefined) add('raw_app_meta_data',{...latest.raw_app_meta_data,...metadata(req.body.app_metadata)});
      if (req.body.email_confirm===true) set.push('email_confirmed_at=now()');
      if (req.body.ban_duration!==undefined) {
        if (req.body.ban_duration==='none') add('banned_until',null);
        else if (/^\d+h$/.test(req.body.ban_duration)) add('banned_until',new Date(Date.now()+Math.min(Number.parseInt(req.body.ban_duration,10),876000)*3600000));
        else fail(422,'Invalid ban duration');
      }
      const {rows}=await db.query(`UPDATE auth.users SET ${[...set,'updated_at=now()'].join(',')} WHERE id=$1 RETURNING *`,args);
      if (password!==undefined || email!==undefined || req.body.ban_duration!==undefined) {
        await db.query('UPDATE hub_identity.sessions SET revoked_at=now() WHERE user_id=$1',[user.id]);
        await db.query('DELETE FROM hub_identity.login_tickets WHERE user_id=$1',[user.id]);
      }
      return rows[0];
    });res.json(publicUser(result));
  });
  app.delete('/admin/users/:id',admin, async (req,res) => {
    // Preserve existing database FK / trigger semantics for account deletion.
    const user=await userById(pool,req.params.id);
    await pool.query('DELETE FROM auth.users WHERE id=$1',[user.id]);
    res.json(publicUser(user));
  });
  app.use((_req,_res)=>fail(404,'Unsupported identity endpoint'));
  app.use((error,_req,res,_next)=>{
    const status=error.status || (error.code==='23505'?422:500);
    // SQL errors can contain email addresses, hashes, or full row values. Never log them.
    if (status>=500) console.error(JSON.stringify({event:'identity_error',code:error.code || 'internal'}));
    res.status(status).json({code:status,error_code:error.code==='23505'?'email_exists':error.status?error.code||'request_failed':'internal_error',
      msg:error.code==='23505'?'An account with this email already exists':error.status?error.message:'Identity temporarily unavailable'});
  });
  return app;
}
