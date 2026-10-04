'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import type { TimerSession } from '@squadhub/shared';
import TimeActivityCalendar from '../../components/time-activity/TimeActivityCalendar';
import { attendanceActivities, dayKey, dayStart, duration, shiftDay, type Activity } from '../../components/time-activity/activityModel';

function sampleSessions(): TimerSession[] {
  const date = dayKey();
  const at = (key: string, minutes: number) => new Date(dayStart(key) + minutes * 60000).toISOString();
  const make = (key: string, start: number, end: number, type: TimerSession['timer_type']): TimerSession => ({
    id: `sample:${key}:${start}`, user_id: 'preview', date: key, timer_type: type,
    start_time: at(key, start), end_time: at(key, end), duration_seconds: (end - start) * 60, is_auto_stopped: false, created_at: at(key, start),
  });
  const result = [make(date, 510, 540, 'no_work'), make(date, 540, 645, 'work'), make(date, 645, 660, 'break'), make(date, 660, 750, 'work'), make(date, 750, 780, 'break'), make(date, 780, 827, 'work')];
  for (let i = 1; i <= 6; i++) {
    const key = shiftDay(date, -i);
    result.push(make(key, 540, 750, 'work'), make(key, 750, 795, 'break'), make(key, 795, i === 2 ? 1185 : 1040, 'work'));
  }
  return result;
}
function sampleTasks(): Activity[] {
  const date = dayKey();
  const make = (key: string, start: number, end: number, kind: 'task' | 'block', title: string, project: string): Activity => ({
    id: `sample:${key}:${start}:${kind}`, kind, title, project, start: dayStart(key) + start * 60000, end: dayStart(key) + end * 60000,
    seconds: (end - start) * 60, source: kind === 'task' ? 'Task timer' : 'Work block timer',
  });
  const result = [
    make(date, 555, 600, 'task', 'Booking engine', 'Squad CRM / Product'),
    make(date, 600, 645, 'task', 'Poster sorting', 'Project Dating / Creative'),
    { ...make(date, 660, 750, 'block', 'Product focus block', 'SquadHub / Development'), children: [
      { task_id: 'demo1', title: 'Squad bots app', seconds: 2400, completed: true },
      { task_id: 'demo2', title: 'Review booking flow', seconds: 3000, completed: false },
    ] },
    make(date, 780, 807, 'task', 'Agency — review required features', 'SquadHire / Product'),
    make(date, 807, 827, 'task', 'GST filings checking', 'Accounts / Finance'),
  ];
  // Dense short sessions reproduce the crowding seen in real task timer history.
  for (let i = 0; i < 30; i++) {
    result.push({ ...make(date, 1230 + i, 1231 + i, 'task', `Quick task ${i + 1}`, 'SquadHub / Development'), id: `sample:burst:${i}`, taskId: `sample:burst-task:${i % 5}` });
  }
  result.push(make(date, 1260, 1320, 'task', 'Create an ad targeting Kerala women', 'Marketing'));
  for (let i = 1; i <= 6; i++) {
    const key = shiftDay(date, -i);
    result.push(make(key, 570, 675, 'block', 'Morning focus', 'SquadHub'), make(key, 810, 900, 'task', 'Booking engine', 'Squad CRM'), make(key, 930, 1020, 'task', 'Squad bots app', 'Squad Bot'));
  }
  return result;
}
export default function DemoHomeTimer() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<TimerSession[]>([]);
  const [tasks, setTasks] = useState<Activity[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setSessions(sampleSessions()); setTasks(sampleTasks());
    setOpen(new URLSearchParams(window.location.search).get('calendar') === 'open');
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const active = sessions.find(s => !s.end_time);
  const work = attendanceActivities(sessions, 9 * 3600, now).filter(e => dayKey(e.start) === dayKey() && (e.kind === 'work' || e.kind === 'overtime')).reduce((s, e) => s + e.seconds, 0);
  const pct = Math.round(work / (9 * 3600) * 100);
  const switchTimer = (kind: TimerSession['timer_type']) => {
    const stamp = new Date().toISOString();
    setSessions(prev => {
      const live = prev.find(s => !s.end_time);
      const closed = prev.map(s => s.end_time ? s : { ...s, end_time: stamp, duration_seconds: Math.floor((Date.parse(stamp) - Date.parse(s.start_time)) / 1000) });
      if (live?.timer_type === kind) return closed;
      return [...closed, { id: `demo-live:${stamp}`, user_id: 'preview', date: dayKey(), timer_type: kind, start_time: stamp, end_time: null, duration_seconds: null, is_auto_stopped: false, created_at: stamp }];
    });
  };
  return <>
    <div className="hm-timer" data-state={active?.timer_type || 'work'} style={{ '--tmr-pct': pct } as CSSProperties}>
      <button className="hm-timer-ring" aria-label="View tracked time calendar" aria-haspopup="dialog" aria-expanded={open} title="View tracked time calendar" onClick={() => setOpen(true)}><span className="pct">{pct}<small>%</small></span></button>
      <div className="hm-timer-body"><div className="hm-timer-meter"><span className="worked">{duration(work)}<em>worked</em></span></div>
        <div className="hm-timer-readout"><span className="commit">of 9h · {pct}%</span><span className="hm-timer-status" data-running={!!active}><span className="hm-timer-dot" />{active ? { work: 'Working', break: 'On a break', no_work: 'Off task' }[active.timer_type] : 'Day so far'}</span></div>
        <div className="hm-timer-bar"><div className="seg work" style={{ width: `${Math.min(pct, 100)}%` }} /><div className="seg break" style={{ width: '8%' }} /></div>
      </div>
      <div className="hm-timer-ctrls">{(['work', 'break', 'no_work'] as const).map(kind => <button key={kind} className="hm-timer-btn" data-type={kind} data-on={active?.timer_type === kind} onClick={() => switchTimer(kind)} aria-label={`${active?.timer_type === kind ? 'Stop' : 'Start'} ${kind.replace('_', ' ')}`}>
        <span className="ic">{active?.timer_type === kind ? '■' : '▸'}</span><span className="lb">{kind === 'no_work' ? 'No work' : kind === 'work' ? 'Work' : 'Break'}</span></button>)}</div>
    </div>
    {open && <TimeActivityCalendar demo onClose={() => setOpen(false)} renderData={(_from, _to, stamp) => <TimeActivityCalendar.Data commitment={9 * 3600} events={[...attendanceActivities(sessions, 9 * 3600, stamp), ...tasks]} />} />}
  </>;
}
