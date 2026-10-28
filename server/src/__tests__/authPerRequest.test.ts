import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const db=vi.hoisted(()=>({getUser:vi.fn(),single:vi.fn(),from:vi.fn()}));
vi.mock('../supabase',()=>({supabaseAuth:{auth:{getUser:db.getUser}},supabaseAdmin:{from:db.from}}));
import { requireAuth } from '../middleware/auth';
function request(token='token'):Request{return {headers:{authorization:'Bearer '+token}} as Request;}
function response(){const r={status:vi.fn(),json:vi.fn()};r.status.mockReturnValue(r);return r;}
beforeEach(()=>{
 vi.clearAllMocks();db.getUser.mockResolvedValue({data:{user:{id:'user',email:'fixture@example.invalid'}},error:null});
 db.single.mockResolvedValue({data:{user_type:'internal',status:'active',display_name:'Fixture'}});
 const q={select:vi.fn(),eq:vi.fn(),single:db.single};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);db.from.mockReturnValue(q);
});
describe('authentication within one HTTP request',()=>{
 it('verifies once while traversing six sibling routers and preserves identity',async()=>{
  const req=request(),res=response(),next=vi.fn();
  for(let n=0;n<6;n++)await requireAuth(req,res as unknown as Response,next);
  expect(db.getUser).toHaveBeenCalledTimes(1);expect(db.single).toHaveBeenCalledTimes(1);expect(next).toHaveBeenCalledTimes(6);
  expect(req).toMatchObject({userId:'user',userEmail:'fixture@example.invalid',userType:'internal',userName:'Fixture'});
 });
 it('rechecks a separate request with the same token and enforces a fresh suspension',async()=>{
  await requireAuth(request(),response() as unknown as Response,vi.fn());
  db.single.mockResolvedValue({data:{status:'suspended'}});const res=response(),next=vi.fn();
  await requireAuth(request(),res as unknown as Response,next);
  expect(db.getUser).toHaveBeenCalledTimes(2);expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
 });
 it('rejects a revoked login on the next request',async()=>{
  await requireAuth(request(),response() as unknown as Response,vi.fn());
  db.getUser.mockResolvedValue({data:{user:null},error:{message:'revoked'}});const res=response(),next=vi.fn();
  await requireAuth(request(),res as unknown as Response,next);expect(res.status).toHaveBeenCalledWith(401);expect(next).not.toHaveBeenCalled();
 });
 it('does not trust caller-populated identity fields or a changed header',async()=>{
  const req=request();req.userId='unverified';const res=response(),next=vi.fn();
  await requireAuth(req,res as unknown as Response,next);expect(req.userId).toBe('user');
  req.headers.authorization='Bearer replacement';db.getUser.mockResolvedValue({data:{user:null},error:{message:'invalid'}});
  await requireAuth(req,res as unknown as Response,next);expect(db.getUser).toHaveBeenCalledTimes(2);expect(res.status).toHaveBeenCalledWith(401);expect(next).toHaveBeenCalledTimes(1);
 });
 it('requires authorization even after an earlier successful pass',async()=>{
  const req=request(),res=response(),next=vi.fn();await requireAuth(req,res as unknown as Response,next);delete req.headers.authorization;
  await requireAuth(req,res as unknown as Response,next);expect(res.status).toHaveBeenCalledWith(401);expect(next).toHaveBeenCalledTimes(1);
 });
});
