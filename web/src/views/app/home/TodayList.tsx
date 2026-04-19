import { useState } from 'react';

type Task = {
  id: number;
  title: string;
  space: string;
  when: string;
  tag: 'client' | 'ops' | 'eng' | 'design' | 'space';
  done: boolean;
  who: string;
  color: string;
};

const INITIAL_TASKS: Task[] = [
  { id: 1, title: 'Review Arbor Co homepage comps', space: 'Arbor Co', when: '10:00 AM', tag: 'client', done: false, who: 'LS', color: 'oklch(0.62 0.13 320)' },
  { id: 2, title: 'Sign off Q2 launch copy — brand voice', space: 'Q2 Launch', when: 'Due today', tag: 'ops', done: false, who: 'MH', color: 'oklch(0.58 0.12 60)' },
  { id: 3, title: 'Lumen partnership — draft MSA v3', space: 'Lumen', when: 'Due tomorrow', tag: 'client', done: false, who: 'NI', color: 'oklch(0.62 0.12 100)' },
  { id: 4, title: 'Pair with Dev on auth migration', space: 'Engineering', when: '2:30 PM', tag: 'eng', done: false, who: 'DK', color: 'oklch(0.6 0.13 150)' },
  { id: 5, title: 'Daily check-in', space: 'Team', when: 'Completed 09:02', tag: 'space', done: true, who: 'AM', color: 'oklch(0.6 0.12 30)' },
];

export default function TodayList() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const toggle = (id: number) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div className="card-head">
        <h3>Today — focus list</h3>
        <span className="link">Reorder</span>
      </div>
      <div className="today-list">
        {tasks.map((t) => (
          <div key={t.id} className="today-item" data-done={t.done}>
            <div
              className="checkbox"
              data-done={t.done}
              onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
            />
            <div>
              <div className="ti-title">{t.title}</div>
              <div className="ti-meta">
                <span className={`tag ${t.tag}`}>{t.space}</span>
                <span>·</span>
                <span>{t.when}</span>
              </div>
            </div>
            <div className="ava" style={{ width: 22, height: 22, borderRadius: '50%', background: t.color, fontSize: 9.5 }}>{t.who}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
