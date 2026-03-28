import { useState } from 'react';

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type SortKey = 'user' | 'work' | 'break' | 'no_work' | 'total' | 'sessions';

interface Props {
  data: any[];
  onSelectUser: (userId: string) => void;
}

export default function TeamStatsTable({ data, onSelectUser }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');

  // Aggregate by user
  const userMap = new Map<string, { name: string; userId: string; work: number; break_: number; noWork: number; sessions: number }>();
  for (const row of data) {
    const userId = row.user_id;
    const name = (row.users as any)?.display_name || userId;
    const existing = userMap.get(userId);
    if (existing) {
      existing.work += row.total_work_seconds;
      existing.break_ += row.total_break_seconds;
      existing.noWork += row.total_no_work_seconds;
      existing.sessions += row.session_count;
    } else {
      userMap.set(userId, {
        name,
        userId,
        work: row.total_work_seconds,
        break_: row.total_break_seconds,
        noWork: row.total_no_work_seconds,
        sessions: row.session_count,
      });
    }
  }

  let rows = Array.from(userMap.values());

  // Filter
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }

  // Sort
  rows.sort((a, b) => {
    let av: number | string, bv: number | string;
    switch (sortKey) {
      case 'user': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case 'work': av = a.work; bv = b.work; break;
      case 'break': av = a.break_; bv = b.break_; break;
      case 'no_work': av = a.noWork; bv = b.noWork; break;
      case 'sessions': av = a.sessions; bv = b.sessions; break;
      default: av = a.work + a.break_ + a.noWork; bv = b.work + b.break_ + b.noWork;
    }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ label, sortId }: { label: string; sortId: SortKey }) => (
    <button
      onClick={() => handleSort(sortId)}
      className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9] hover:text-[#0F172B]"
    >
      {label}
      {sortKey === sortId && <span>{sortAsc ? '\u2191' : '\u2193'}</span>}
    </button>
  );

  return (
    <div>
      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users..."
          className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] focus:border-[#0F172B] focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-3 py-2 text-left"><SortHeader label="User" sortId="user" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="Work" sortId="work" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="Break" sortId="break" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="No Work" sortId="no_work" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="Total" sortId="total" /></th>
              <th className="px-3 py-2 text-right"><SortHeader label="Sessions" sortId="sessions" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.work + row.break_ + row.noWork;
              return (
                <tr
                  key={row.userId}
                  onClick={() => onSelectUser(row.userId)}
                  className="cursor-pointer border-b border-[#E2E8F0] transition hover:bg-[#F8FAFC] last:border-b-0"
                >
                  <td className="px-3 py-2 text-sm font-medium text-[#0F172B]">{row.name}</td>
                  <td className="px-3 py-2 text-right text-sm text-blue-600">{formatDuration(row.work)}</td>
                  <td className="px-3 py-2 text-right text-sm text-amber-600">{formatDuration(row.break_)}</td>
                  <td className="px-3 py-2 text-right text-sm text-gray-500">{formatDuration(row.noWork)}</td>
                  <td className="px-3 py-2 text-right text-sm font-medium text-[#0F172B]">{formatDuration(total)}</td>
                  <td className="px-3 py-2 text-right text-sm text-[#62748E]">{row.sessions}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-[#90A1B9]">No data found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
