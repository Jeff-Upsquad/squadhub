import pg from 'pg';
import { createApp } from './service.mjs';
const pool=new pg.Pool({connectionString:process.env.IDENTITY_DATABASE_URL,max:5,connectionTimeoutMillis:5000,
  idleTimeoutMillis:30000,statement_timeout:10000});
const app=createApp(pool,{jwtSecret:process.env.LOCAL_JWT_SECRET,anonKey:process.env.LOCAL_ANON_KEY,
  serviceKey:process.env.LOCAL_SERVICE_ROLE_KEY,issuer:process.env.LOCAL_AUTH_ISSUER,
  publicUrl:process.env.LOCAL_AUTH_PUBLIC_URL,redirectUrls:(process.env.LOCAL_AUTH_REDIRECT_URLS || '').split(',').filter(Boolean),
  rateLimitSecret:process.env.IDENTITY_RATE_LIMIT_SECRET,accessSeconds:900,refreshSeconds:30*86400});
const server=app.listen(4101,'0.0.0.0',()=>console.log('Local identity listening on 4101'));
const cleanup=setInterval(()=>pool.query(`DELETE FROM hub_identity.rate_limits WHERE reset_at<now();
  DELETE FROM hub_identity.login_tickets WHERE expires_at<now();
  DELETE FROM hub_identity.sessions WHERE expires_at<now() OR revoked_at<now()-interval '7 days'`)
  .catch(()=>console.error('Identity retention failed')),3600000).unref();
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{
  clearInterval(cleanup); server.close(()=>pool.end().then(()=>process.exit(0)));
});
