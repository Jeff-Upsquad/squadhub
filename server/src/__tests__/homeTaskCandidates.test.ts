import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { rpc } }));
import { getHomeTaskCandidates } from '../utils/homeTaskCandidates';
const digest='a'.repeat(64), newer='b'.repeat(64);
let sequence=0;
beforeEach(()=>{vi.clearAllMocks();sequence++;});
describe('fresh Home task snapshots',()=>{
 it('revalidates unchanged rows on every call and isolates caller mutations',async()=>{
  const user='unchanged-'+sequence;rpc.mockResolvedValueOnce({data:{digest,rows:[{id:'task',metadata:{label:'original'}}]},error:null});
  const first=await getHomeTaskCandidates(user,'assigned');first[0].metadata.label='mutated';
  rpc.mockResolvedValue({data:{digest,rows:null},error:null});
  const second=await getHomeTaskCandidates(user,'assigned');second[0].metadata.label='also mutated';
  expect(await getHomeTaskCandidates(user,'assigned')).toEqual([{id:'task',metadata:{label:'original'}}]);
  expect(rpc).toHaveBeenCalledTimes(3);expect(rpc.mock.calls[1][1].p_known_digest).toBe(digest);
 });
 it('returns changed data immediately, with no expiry-based staleness',async()=>{
  const user='changed-'+sequence;rpc.mockResolvedValueOnce({data:{digest,rows:[{id:'task',title:'before'}]},error:null});await getHomeTaskCandidates(user,'new');
  rpc.mockResolvedValue({data:{digest:newer,rows:[{id:'task',title:'after'}]},error:null});
  expect(await getHomeTaskCandidates(user,'new')).toEqual([{id:'task',title:'after'}]);
 });
 it('separates users, modes and Show reviewed options',async()=>{
  const user='scope-'+sequence;rpc.mockResolvedValue({data:{digest,rows:[]},error:null});
  await getHomeTaskCandidates(user,'new');await getHomeTaskCandidates(user+'-other','new');await getHomeTaskCandidates(user,'focused');await getHomeTaskCandidates(user,'new',{includeReviewed:true});
  expect(rpc.mock.calls.every(call=>call[1].p_known_digest===null)).toBe(true);
 });
 it('preserves all 1001 eligible rows in the single JSON result',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({id:String(i)}));rpc.mockResolvedValue({data:{digest,rows},error:null});
  expect(await getHomeTaskCandidates('many-'+sequence,'new')).toEqual(rows);
 });
 it('normalizes worked IDs without mixing a different set',async()=>{
  const user='worked-'+sequence;rpc.mockResolvedValueOnce({data:{digest,rows:[]},error:null});await getHomeTaskCandidates(user,'worked',{taskIds:['b','a','a']});
  rpc.mockResolvedValueOnce({data:{digest,rows:null},error:null});await getHomeTaskCandidates(user,'worked',{taskIds:['a','b']});
  expect(rpc.mock.calls[0][1].p_task_ids).toEqual(['a','b']);expect(rpc.mock.calls[1][1].p_known_digest).toBe(digest);
 });
 it('fails visibly on database errors rather than serving an old snapshot',async()=>{
  const user='failure-'+sequence;rpc.mockResolvedValueOnce({data:{digest,rows:[{id:'task'}]},error:null});await getHomeTaskCandidates(user,'new');
  const error={message:'unavailable'};rpc.mockResolvedValue({data:null,error});await expect(getHomeTaskCandidates(user,'new')).rejects.toEqual(error);
 });
 it('rejects an unchanged response without a matching body',async()=>{
  rpc.mockResolvedValue({data:{digest,rows:null},error:null});await expect(getHomeTaskCandidates('missing-'+sequence,'new')).rejects.toThrow('body unavailable');
 });
});
