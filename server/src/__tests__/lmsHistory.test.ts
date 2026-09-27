import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const state = vi.hoisted(() => ({ rows: [] as any[], level: 'admin' as string | null, reads: 0 }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: () => {
  state.reads++;
  const filters: [string, unknown][] = [];
  let fields = ''; let start = 0; let end = 999;
  const result = () => ({ data: state.rows.filter(r => filters.every(([k,v]) => r[k] === v)).slice(start,end+1)
    .map(r => Object.fromEntries(fields.split(',').map(k => k.trim()).map(k => [k,r[k]]))), error: null });
  const q: any = {
    select: (s: string) => {fields=s;return q;}, eq: (k: string,v: unknown) => {filters.push([k,v]);return q;},
    order: () => q, range: (a: number,b: number) => {start=a;end=b;return q;},
    maybeSingle: async () => ({data:result().data[0] ?? null,error:null}), then: (resolve: any) => resolve(result()),
  };return q;
} } }));
vi.mock('../middleware/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('../services/lmsAccess', () => ({ getItemAccess: vi.fn(async () => state.level), meetsAccess: (level: string) => level === 'admin', getItemApproverUserIds: vi.fn() }));
vi.mock('../services/lmsAuthoring', () => ({ cloneItemForReview: vi.fn(), notifyLms: vi.fn() }));
vi.mock('../services/lmsTaskSends', () => ({ createSend: vi.fn(), listSendsForItem: vi.fn(), recipientsForSend: vi.fn() }));
vi.mock('../services/lmsBlockVideos', () => ({ loadBlockVideos: vi.fn(), withBlockVideos: vi.fn() }));
vi.mock('../services/squadhireTraining', () => ({ syncContentToSquadhire: vi.fn(), syncItemToSquadhire: vi.fn(), isSquadhireSynced: vi.fn() }));
import { readLmsHistory } from '../services/lmsHistory';
import router from '../routes/lms-collab';
const itemId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const response = () => ({status:vi.fn().mockReturnThis(),json:vi.fn()});
beforeEach(() => {state.level='admin';state.reads=0;state.rows=[{id:versionId,item_id:itemId,change_label:'Content updated',page_title:'Onboarding',changed_at:'2026-09-27T12:00:00Z',snapshot:{pages:[{title:'Private previous answer'}]}}];});
async function read(params: any,query = {}) {const res=response();await readLmsHistory({params,query} as Request,res as unknown as Response);return res;}
describe('document history', () => {
 it('lists metadata only, with bounded pagination',async()=>{
   state.rows=Array.from({length:32},(_,i)=>({...state.rows[0],id:`version-${i}`}));
   const first=await read({id:itemId});const payload=first.json.mock.calls[0][0];
   expect(payload.data).toHaveLength(30);expect(payload.has_more).toBe(true);expect(payload.data[0]).not.toHaveProperty('snapshot');
   const second=await read({id:itemId},{page:1});expect(second.json.mock.calls[0][0].data).toHaveLength(2);
 });
 it('cannot read a version through a different document',async()=>{
   const res=await read({id:'10000000-0000-4000-8000-000000000002',versionId});expect(res.status).toHaveBeenCalledWith(404);
 });
 it('returns the immutable snapshot for the authorized document',async()=>{
   const res=await read({id:itemId,versionId});expect(res.json.mock.calls[0][0].data.snapshot.pages[0].title).toBe('Private previous answer');
 });
 it('rejects invalid identifiers and pagination',async()=>{
   expect((await read({id:'bad'})).status).toHaveBeenCalledWith(400);
   expect((await read({id:itemId},{page:-1})).status).toHaveBeenCalledWith(400);
 });
 const route = router.stack.find((r: any) => Array.isArray(r.route?.path) && r.route.path.includes('/items/:id/changes'))?.route;
 it.each([null,'viewer','commenter','contributor'])('does not expose historical drafts to %s',async level=>{
   state.level=level;const res=response();expect(route).toBeTruthy();
   await route!.stack[0].handle({params:{id:itemId,versionId},query:{},userId:'user'} as unknown as Request,res as unknown as Response,vi.fn());
   expect(res.status).toHaveBeenCalledWith(403);expect(state.reads).toBe(0);
 });
 it('lets a document admin open Changes',async()=>{
   const res=response();await route!.stack[0].handle({params:{id:itemId},query:{},userId:'admin'} as unknown as Request,res as unknown as Response,vi.fn());
   expect(res.json.mock.calls[0][0].success).toBe(true);
 });
});
