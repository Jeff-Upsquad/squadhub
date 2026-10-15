import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => {
  const memory = new Map<string,string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{
    getItem:(key:string)=>memory.get(key) ?? null, setItem:(key:string,value:string)=>memory.set(key,value),
    removeItem:(key:string)=>memory.delete(key), clear:()=>memory.clear(),
  }});
  return { effect: null as null | (() => void), cleanup: null as null | (() => void),
    on: vi.fn(), off: vi.fn(), emit: vi.fn(), get: vi.fn(), post: vi.fn(),
    stop: vi.fn(), start: vi.fn(), invalidate: vi.fn() };
});
vi.mock('react', async original => ({ ...(await original<object>()),
  useEffect:(effect:()=>()=>void)=>{mock.effect=()=>{mock.cleanup=effect();};}, useRef:(value:unknown)=>({current:value}),
}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:mock.invalidate})}));
vi.mock('../services/socket',()=>({connectSocket:()=>({connected:true,on:mock.on,off:mock.off,emit:mock.emit})}));
vi.mock('../services/api',()=>({default:{get:mock.get,post:mock.post}}));
vi.mock('../stores/authStore',()=>({useAuthStore:{getState:()=>({user:{id:'user',user_type:'internal'}})}}));
vi.mock('../hooks/useParallelTimers',()=>({useParallelTimers:()=>({stopTimer:mock.stop,startTimer:mock.start})}));
import { usePMStore, type TimerShare } from '../stores/pmStore';
import { useCompanionTaskTimers } from '../hooks/useCompanionTaskTimers';
import type { CompanionTimerCommand, CompanionTimerReply } from '@squadhub/shared';
let logged: TimerShare[];
let command: (c:CompanionTimerCommand, reply:(r:CompanionTimerReply)=>void)=>void;
const run = (action:CompanionTimerCommand['action'],taskId?:string,requestId=crypto.randomUUID()) =>
  new Promise<CompanionTimerReply>(resolve=>command({action,taskId,requestId},resolve));
beforeEach(()=>{
  vi.useFakeTimers(); vi.stubGlobal('window', {setInterval}); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); vi.clearAllMocks();
  usePMStore.setState({timers:[],pausedTimers:[],timerSegmentStart:null}); logged=[];
  mock.get.mockResolvedValue({data:{data:{session:{timer_type:'break'},time_tracked:60}}});
  mock.post.mockResolvedValue({data:{}});
  mock.stop.mockImplementation(async(id:string)=>{const result=usePMStore.getState().stopParallelTimer(id); if(result) logged.push(...result.shares);});
  mock.start.mockImplementation(async(t:any)=>!!usePMStore.getState().startParallelTimer(t.taskId,t.taskTitle,t.listId,t.baseTracked));
  useCompanionTaskTimers('user','workspace'); mock.effect!();
  command=mock.on.mock.calls.find(c=>c[0]==='companion_timer_command')![1];
});
afterEach(()=>{mock.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals();});
describe('companion pause/resume accounting',()=>{
  it('logs parallel shares once, excludes paused time, and preserves the displayed session',async()=>{
    const start=Date.now();
    usePMStore.getState().startParallelTimer('a','Task A','list',0);
    usePMStore.getState().startParallelTimer('b','Task B','list',0);
    vi.setSystemTime(start+60_000);
    expect((await run('pause','a')).success).toBe(true);
    expect(logged.map(s=>[s.taskId,s.seconds])).toEqual([['a',30],['b',30]]);
    const session=usePMStore.getState().pausedTimers[0].sessionId;
    vi.setSystemTime(start+90_000);
    await run('pause','b');
    expect(logged.map(s=>[s.taskId,s.seconds])).toEqual([['a',30],['b',30],['b',30]]);
    vi.setSystemTime(start+150_000);
    expect((await run('resume','a')).success).toBe(true);
    expect(mock.post).toHaveBeenCalledWith('/timer/start',{timer_type:'work',workspace_id:'workspace',context:'teammates'});
    expect(usePMStore.getState().timers[0]).toMatchObject({elapsedBefore:60,sessionId:session,startedAt:start+150_000});
    vi.setSystemTime(start+180_000);
    await run('stop','a');
    expect(logged.filter(s=>s.taskId==='a').reduce((n,s)=>n+s.seconds,0)).toBe(60);
    expect(usePMStore.getState().pausedTimers.map(t=>t.taskId)).toEqual(['b']);
  });
  it('stopping a paused task never logs the already closed segment again',async()=>{
    const start=Date.now(); usePMStore.getState().startParallelTimer('a','Task A','list',0);
    vi.setSystemTime(start+60_000); await run('pause','a');
    await run('stop','a');
    expect(logged).toHaveLength(1); expect(logged[0].seconds).toBe(60);
    expect(usePMStore.getState().pausedTimers).toEqual([]);
  });
  it('keeps a paused task available when resuming cannot reach the API', async()=>{
    usePMStore.getState().startParallelTimer('a','Task A','list',0);
    await run('pause','a');
    mock.get.mockRejectedValueOnce(new Error('Offline'));
    expect(await run('resume','a')).toEqual({success:false,error:'Offline'});
    expect(usePMStore.getState().pausedTimers.map(t=>t.taskId)).toEqual(['a']);
    expect(usePMStore.getState().timers).toEqual([]);
  });
  it('deduplicates a retried command in the browser',async()=>{
    usePMStore.getState().startParallelTimer('a','Task A','list',0);
    const id=crypto.randomUUID();
    await Promise.all([run('pause','a',id),run('pause','a',id)]);
    expect(mock.stop).toHaveBeenCalledOnce();
  });
});
