// Run only against the isolated stack, using its private generated env file.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const base=process.env.TRIAL_API_URL || 'http://gateway:8080';
if(!['gateway','squadhub-data','127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Only an isolated local API is allowed');
const admin=createClient(base,process.env.LOCAL_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const client=createClient(base,process.env.LOCAL_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`migration-probe-${randomBytes(6).toString('hex')}@example.invalid`,password=randomBytes(20).toString('hex');
let id;
let load;
const extras=[],invitations=[];
const check=(result,label)=>{assert.equal(result.error,null,`${label}: ${result.error?.code || result.error?.status || 'error'}`);return result.data;};
try{
  const user=check(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'Migration probe'}}),'create user');id=user.user.id;
  if(process.env.TRIAL_APP_URL){
    const unprovisioned=await fetch(process.env.TRIAL_APP_URL+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(unprovisioned.status,403,'sibling identity alone cannot enter SquadHub');
    const signup=await client.auth.signUp({email:'uninvited-'+email,password});assert.equal(signup.error?.status,403);
    const register=await fetch(process.env.TRIAL_APP_URL+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'uninvited-'+email,password,display_name:'Uninvited'})});
    assert.equal(register.status,403,'Hub registration requires an invitation');
  }
  check(await admin.from('users').upsert({id,email,display_name:'Migration probe',status:'active',user_type:'internal'}),'profile write');
  const session=check(await client.auth.signInWithPassword({email,password}),'login').session;
  assert.equal(check(await client.auth.getUser(session.access_token),'verify user').user.id,id);
  const before=await admin.from('users').select('id',{count:'exact',head:true});check(before,'count');assert.ok(before.count>=40);
  check(await admin.from('notifications').select('id,actor:users!notifications_actor_id_fkey(id,display_name)').limit(1),'embedded relationship');
  check(await admin.rpc('chat_unread_summary',{p_user_id:id}),'database RPC');
  const workspace=check(await admin.from('workspaces').select('id').limit(1),'workspace lookup')[0];
  assert.ok(workspace?.id,'Imported workspace required for app smoke test');
  // Profiles are intentionally server-only in the imported schema.
  const privateProfile=await client.from('users').select('id').eq('id',id);assert.ok(privateProfile.error || privateProfile.data?.length===0);
  // A query through the real app checks middleware + SDK + PostgREST together.
  if(process.env.TRIAL_APP_URL){
    const invitedEmail='invited-'+email;
    const invitation=check(await admin.from('invitations').insert({email:invitedEmail,user_type:'internal',status:'pending',invited_by:id,expires_at:new Date(Date.now()+86400000).toISOString()}).select('id').single(),'create pending invitation');invitations.push(invitation.id);
    const accepted=await fetch(process.env.TRIAL_APP_URL+'/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:invitedEmail,password,display_name:'Invited probe'})});
    assert.equal(accepted.status,201,'invited Hub registration');
    const invitedProfile=check(await admin.from('users').select('id,status').eq('email',invitedEmail).single(),'invited profile');extras.push(invitedProfile.id);assert.equal(invitedProfile.status,'active');
    const invitedLogin=await fetch(process.env.TRIAL_APP_URL+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:invitedEmail,password})});assert.equal(invitedLogin.status,200,'invited account login');
    const crmLink=check(await admin.auth.admin.generateLink({type:'invite',email:'crm-'+email,options:{redirectTo:'http://127.0.0.1:55400/invite-accepted',data:{display_name:'CRM invite probe'}}}),'CRM invitation');extras.push(crmLink.user.id);
    check(await admin.from('users').upsert({id:crmLink.user.id,email:'crm-'+email,display_name:'CRM invite probe',status:'active',user_type:'internal'}),'CRM invite profile');
    const action=new URL(crmLink.properties.action_link);
    const redemption=process.env.TRIAL_APP_URL+'/auth/invite/verify'+action.search;
    const redeemed=await fetch(redemption,{redirect:'manual'});assert.equal(redeemed.status,303,'invitation through app proxy');
    const location=new URL(redeemed.headers.get('location'));assert.equal(location.origin+location.pathname,'http://127.0.0.1:55400/invite-accepted');
    const fragment=new URLSearchParams(location.hash.slice(1));
    const invitedClient=createClient(base,process.env.LOCAL_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    check(await invitedClient.auth.setSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')}),'invitation session');
    check(await invitedClient.auth.updateUser({password:password+'invite'}),'invited password setup');
    assert.equal((await fetch(redemption,{redirect:'manual'})).status,400,'invitation replay rejected');
    const r=await fetch(`${process.env.TRIAL_APP_URL}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(r.status,200,'app login');const data=await r.json();assert.equal(data.success,true);
    for(const path of ['/users/me','/notifications?limit=1','/notifications/unread-count','/messages/unread-summary',`/timer/active?workspace_id=${workspace.id}`]){
      const response=await fetch(process.env.TRIAL_APP_URL+path,{headers:{authorization:`Bearer ${data.data.access_token}`}});
      assert.equal(response.status,200,`app ${path}`);
    }
    const times=[];let issued=0;const started=performance.now();
    await Promise.all(Array.from({length:10},async()=>{
      while(issued++<100){
        const start=performance.now();
        const r=await fetch(process.env.TRIAL_APP_URL+'/notifications/unread-count',{headers:{authorization:`Bearer ${data.data.access_token}`}});
        assert.equal(r.status,200,'concurrent protected request');await r.arrayBuffer();times.push(performance.now()-start);
      }
    }));
    times.sort((a,b)=>a-b);
    load={requests:times.length,concurrency:10,total_ms:Math.round(performance.now()-started),p95_ms:Math.round(times[Math.floor(times.length*.95)])};
    const changed=await fetch(process.env.TRIAL_APP_URL+'/auth/change-password',{method:'POST',headers:{authorization:`Bearer ${data.data.access_token}`,'content-type':'application/json'},body:JSON.stringify({new_password:password+'new'})});
    assert.equal(changed.status,200,'app password change');
    const continued=await fetch(process.env.TRIAL_APP_URL+'/notifications/unread-count',{headers:{authorization:`Bearer ${data.data.access_token}`}});
    assert.equal(continued.status,200,'caller remains logged in after password change');
    const logout=await fetch(process.env.TRIAL_APP_URL+'/auth/logout',{method:'POST',headers:{authorization:`Bearer ${data.data.access_token}`,'content-type':'application/json'},body:'{}'});assert.equal(logout.status,200);
    const revoked=await fetch(process.env.TRIAL_APP_URL+'/notifications/unread-count',{headers:{authorization:`Bearer ${data.data.access_token}`}});assert.equal(revoked.status,401,'logout revokes app access');
  }
  check(await client.auth.signOut(),'logout');
  assert.ok((await client.auth.getUser(session.access_token)).error);
  console.log(JSON.stringify({status:'passed',sdk_transport:true,embedded_relationship:true,rpc:true,rls:true,
    login:true,logout:true,real_app:!!process.env.TRIAL_APP_URL,load}));
}finally{
  for(const invitation of invitations)check(await admin.from('invitations').delete().eq('id',invitation),'cleanup invitation');
  for(const extra of extras){check(await admin.from('users').delete().eq('id',extra),'cleanup invited profile');check(await admin.auth.admin.deleteUser(extra),'cleanup invited identity');}
  if(id){check(await admin.from('users').delete().eq('id',id),'cleanup profile');check(await admin.auth.admin.deleteUser(id),'cleanup identity');}
}
