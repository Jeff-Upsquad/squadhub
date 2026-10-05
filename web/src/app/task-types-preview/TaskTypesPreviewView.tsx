'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTaskTypes } from '../../hooks/useTaskTypes';
import TaskTypeDropdown, {
  TaskTypeGlyph,
  getTaskTypeGroup,
  getTaskTypeDescription,
  GROUP_ORDER,
  DEFAULT_TASK_TYPE_GROUPS,
  DEFAULT_TASK_TYPE_DESCRIPTIONS,
} from '../../components/pm/TaskTypeDropdown';
import type { TaskType } from '@squadhub/shared';

export default function TaskTypesPreviewView() {
  const { data: dbTypes = [], isLoading } = useTaskTypes();

  // If DB types are loading or empty, fallback to complete catalogue
  const taskTypes: TaskType[] = useMemo(() => {
    if (dbTypes && dbTypes.length > 0) return dbTypes;

    // Fallback static list while loading
    return Object.keys(DEFAULT_TASK_TYPE_GROUPS).map((key, i) => ({
      id: `fallback-${key}`,
      key,
      name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: DEFAULT_TASK_TYPE_DESCRIPTIONS[key] || null,
      group_name: DEFAULT_TASK_TYPE_GROUPS[key],
      icon: 'check-square',
      color: '#3b82f6',
      position: i,
      is_default: key === 'task',
      is_system: true,
      is_enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }, [dbTypes]);

  const [selectedType, setSelectedType] = useState<TaskType | null>(null);
  const [directorySearch, setDirectorySearch] = useState('');

  // Initial selection
  const current = useMemo(() => {
    if (selectedType) return selectedType;
    return taskTypes.find((t) => t.is_default) || taskTypes[0] || null;
  }, [selectedType, taskTypes]);

  // Grouped for Directory Matrix
  const directoryGroups = useMemo(() => {
    const q = directorySearch.trim().toLowerCase();
    const map = new Map<string, TaskType[]>();

    for (const t of taskTypes) {
      if (t.is_enabled === false) continue;
      const name = (t.name || '').toLowerCase();
      const desc = getTaskTypeDescription(t).toLowerCase();
      const group = getTaskTypeGroup(t).toLowerCase();
      const key = (t.key || '').toLowerCase();

      if (q && !name.includes(q) && !desc.includes(q) && !group.includes(q) && !key.includes(q)) {
        continue;
      }

      const g = getTaskTypeGroup(t);
      const list = map.get(g) || [];
      list.push(t);
      map.set(g, list);
    }

    const res: { groupName: string; items: TaskType[] }[] = [];
    for (const gName of GROUP_ORDER) {
      if (map.has(gName)) {
        res.push({ groupName: gName, items: map.get(gName)! });
        map.delete(gName);
      }
    }
    for (const [gName, items] of map.entries()) {
      res.push({ groupName: gName, items });
    }
    return res;
  }, [taskTypes, directorySearch]);

  const totalTypesCount = useMemo(() => {
    return taskTypes.filter((t) => t.is_enabled !== false).length;
  }, [taskTypes]);

  return (
    <div className="min-h-screen bg-[var(--surface-alt)] text-[var(--sh-ink)] font-sans antialiased p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--sh-hair)] pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#2962FF] text-white font-bold text-sm">
                TT
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--sh-ink)]">
                Task Types & Categorization
              </h1>
              <span className="ml-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#2962FF]/10 text-[#2962FF]">
                {totalTypesCount} Types in {GROUP_ORDER.length} Groups
              </span>
            </div>
            <p className="text-sm text-[var(--sh-ink-3)] mt-1.5 max-w-2xl">
              Searchable, categorized dropdown for tasks. Every task type shows its name and clear definition, organized into logical groups with instant keyboard search.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/app"
              className="px-3.5 py-1.5 rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] hover:bg-[var(--surface-alt)] text-xs font-medium text-[var(--sh-ink)] shadow-xs transition"
            >
              Open PM App →
            </Link>
            <a
              href="http://localhost:3001/admin/task-types"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-[#2962FF] hover:bg-[#1d4ed8] text-xs font-medium text-white shadow-xs transition"
            >
              Admin Task Types ↗
            </a>
          </div>
        </header>

        {/* Live Interactive Dropdown Showcase */}
        <section className="bg-[var(--surface)] border border-[var(--sh-hair)] rounded-2xl p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--sh-ink)]">
                1. Interactive Dropdown Component
              </h2>
              <p className="text-xs text-[var(--sh-ink-3)]">
                Click the type badge below to open the searchable, grouped dropdown exactly as rendered inside Task Detail & Task Create panels.
              </p>
            </div>
            {isLoading && (
              <span className="text-xs text-[var(--sh-ink-4)] animate-pulse">Syncing with database...</span>
            )}
          </div>

          {/* Simulated Task Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface-alt)]/50 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--sh-hair)] pb-3">
                <span className="text-xs font-mono text-[var(--sh-ink-4)] uppercase tracking-wider">
                  Task Properties Preview
                </span>
                <span className="text-xs text-[var(--sh-ink-4)]">Interactive</span>
              </div>

              {/* Title row */}
              <div>
                <input
                  type="text"
                  defaultValue="Prepare quarterly growth presentation"
                  className="w-full text-base font-semibold bg-transparent border-none outline-none text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)]"
                  placeholder="Task title..."
                />
              </div>

              {/* Property row with the Dropdown */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--sh-ink-3)]">Task Type:</span>
                  {/* The Dropdown */}
                  <TaskTypeDropdown
                    taskTypes={taskTypes}
                    current={current}
                    onChange={(t) => setSelectedType(t)}
                    width={360}
                  />
                </div>

                <div className="text-xs text-[var(--sh-ink-4)] italic">
                  ← Click badge to test search & grouping
                </div>
              </div>

              {/* Description preview */}
              {current && (
                <div
                  className="mt-4 p-3.5 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] flex items-start gap-3"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: current.color || '#3b82f6',
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${current.color || '#3b82f6'} 15%, transparent)`,
                      color: current.color || '#3b82f6',
                    }}
                  >
                    <TaskTypeGlyph icon={current.icon} color={current.color} size={16} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--sh-ink)]">{current.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface-alt)] text-[var(--sh-ink-3)]">
                        {getTaskTypeGroup(current)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--sh-ink-3)] leading-relaxed">
                      {getTaskTypeDescription(current)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Inspector side panel */}
            <div className="rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-5 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">
                Selected Type Metadata
              </h3>
              {current ? (
                <dl className="space-y-2.5 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-[var(--sh-hair)]/60">
                    <dt className="text-[var(--sh-ink-4)]">Name</dt>
                    <dd className="font-semibold text-[var(--sh-ink)]">{current.name}</dd>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[var(--sh-hair)]/60">
                    <dt className="text-[var(--sh-ink-4)]">Group</dt>
                    <dd className="font-medium text-[var(--sh-ink-2)]">{getTaskTypeGroup(current)}</dd>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[var(--sh-hair)]/60">
                    <dt className="text-[var(--sh-ink-4)]">System Key</dt>
                    <dd className="font-mono text-[11px] text-[var(--sh-ink-3)]">{current.key}</dd>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[var(--sh-hair)]/60">
                    <dt className="text-[var(--sh-ink-4)]">Color</dt>
                    <dd className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: current.color }} />
                      {current.color}
                    </dd>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-[var(--sh-hair)]/60">
                    <dt className="text-[var(--sh-ink-4)]">Icon</dt>
                    <dd className="flex items-center gap-1.5 text-[var(--sh-ink-3)]">
                      <TaskTypeGlyph icon={current.icon} color={current.color} size={14} />
                      <span className="font-mono text-[11px]">{current.icon}</span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <dt className="text-[var(--sh-ink-4)]">Flags</dt>
                    <dd className="flex gap-1">
                      {current.is_default && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600">Default</span>
                      )}
                      {current.is_system && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600">System</span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-[var(--sh-ink-4)]">No type selected</p>
              )}
            </div>
          </div>
        </section>

        {/* Complete Grouped Directory Matrix */}
        <section className="bg-[var(--surface)] border border-[var(--sh-hair)] rounded-2xl p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--sh-ink)]">
                2. Complete Task Types Directory
              </h2>
              <p className="text-xs text-[var(--sh-ink-3)]">
                All 34 task types categorized across 10 groups. Click any card to select it in the interactive demo above.
              </p>
            </div>

            {/* Directory search filter */}
            <div className="relative w-full sm:w-64">
              <svg
                className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[var(--sh-ink-4)] pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={directorySearch}
                onChange={(e) => setDirectorySearch(e.target.value)}
                placeholder="Filter directory..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--surface-alt)] border border-[var(--sh-hair)] rounded-lg text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none focus:border-[#2962FF]"
              />
              {directorySearch && (
                <button
                  type="button"
                  onClick={() => setDirectorySearch('')}
                  className="absolute right-2.5 top-1.5 text-xs text-[var(--sh-ink-4)] hover:text-[var(--sh-ink-2)]"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Directory Groups */}
          <div className="space-y-6">
            {directoryGroups.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--sh-ink-4)]">
                No task types match &quot;{directorySearch}&quot;.
              </div>
            ) : (
              directoryGroups.map((group) => (
                <div key={group.groupName} className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-[var(--sh-hair)]/60 pb-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--sh-ink-2)]">
                      {group.groupName}
                    </span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-medium bg-[var(--surface-alt)] text-[var(--sh-ink-3)]">
                      {group.items.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.items.map((t) => {
                      const isSelected = current?.id === t.id;
                      const desc = getTaskTypeDescription(t);

                      return (
                        <div
                          key={t.id}
                          onClick={() => setSelectedType(t)}
                          className={`cursor-pointer group rounded-xl border p-3.5 transition-all flex flex-col justify-between gap-2.5 ${
                            isSelected
                              ? 'border-[#2962FF] bg-[#2962FF]/5 shadow-xs ring-1 ring-[#2962FF]/30'
                              : 'border-[var(--sh-hair)] bg-[var(--surface)] hover:bg-[var(--surface-alt)] hover:border-[var(--sh-ink-4)]/40'
                          }`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                                  style={{
                                    backgroundColor: `color-mix(in srgb, ${t.color || '#6b7280'} 16%, transparent)`,
                                    color: t.color || '#6b7280',
                                  }}
                                >
                                  <TaskTypeGlyph icon={t.icon} color={t.color} size={13} />
                                </div>
                                <span className="text-xs font-semibold text-[var(--sh-ink)]">
                                  {t.name}
                                </span>
                              </div>

                              <div className="flex items-center gap-1">
                                {t.is_default && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                    Default
                                  </span>
                                )}
                              </div>
                            </div>

                            {desc && (
                              <p className="text-[11.5px] text-[var(--sh-ink-3)] leading-relaxed line-clamp-2">
                                {desc}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-[var(--sh-ink-4)] font-mono pt-1 border-t border-[var(--sh-hair)]/40">
                            <span>{t.key}</span>
                            <span className="text-[9px] opacity-75">Click to preview</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Footer info */}
        <footer className="text-center py-6 text-xs text-[var(--sh-ink-4)] space-y-1 border-t border-[var(--sh-hair)]">
          <p>Task Types feature integrated across SquadHub (Task Detail Panel, Task Create Panel, and Admin Portal).</p>
          <p>Localhost Preview · Port 3000</p>
        </footer>
      </div>
    </div>
  );
}
