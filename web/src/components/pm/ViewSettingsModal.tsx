import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ListView, ListViewRow, ListViewConfig, TaskPriority } from '@squadhub/shared';
import { useTaskTypes } from '../../hooks/useTaskTypes';
import { getTaskTypeGroup, GROUP_ORDER } from './TaskTypeDropdown';
import { useListLabelPicker } from '../../hooks/useLabels';
import { PRIORITY_META } from '../../views/app/pm/PriorityPicker';

const TYPE_OPTIONS: { type: ListView; label: string; desc: string; icon: ReactNode }[] = [
  {
    type: 'list',
    label: 'List',
    desc: 'Classic vertical task list with grouping',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
  {
    type: 'board',
    label: 'Board',
    desc: 'Kanban columns grouped by status',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    type: 'whiteboard',
    label: 'Whiteboard',
    desc: 'Freeform visual canvas',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v11a1 1 0 01-1 1h-5l-3 3-3-3H5a1 1 0 01-1-1V5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 12.5h5" />
      </svg>
    ),
  },
];

const STANDARD_PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'none', label: 'None', color: '#94a3b8' },
  { value: 'low', label: 'Low', color: PRIORITY_META.low.color },
  { value: 'normal', label: 'Normal', color: PRIORITY_META.normal.color },
  { value: 'high', label: 'High', color: PRIORITY_META.high.color },
  { value: 'urgent', label: 'Urgent', color: PRIORITY_META.urgent.color },
];

interface ViewSettingsModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialView?: ListViewRow | null;
  listId: string;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    view_type: ListView;
    config: ListViewConfig;
    is_private?: boolean;
  }) => void;
  isSaving?: boolean;
}

export default function ViewSettingsModal({
  isOpen,
  mode,
  initialView,
  listId,
  onClose,
  onSave,
  isSaving = false,
}: ViewSettingsModalProps) {
  const [name, setName] = useState('');
  const [viewType, setViewType] = useState<ListView>('list');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [includeInTimeReport, setIncludeInTimeReport] = useState(true);
  const [defaultPriority, setDefaultPriority] = useState<string>('none');
  const [defaultTaskTypeId, setDefaultTaskTypeId] = useState<string>('');
  const [defaultLabel, setDefaultLabel] = useState<string>('');
  const [showAllTasks, setShowAllTasks] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch task types and labels
  const { data: taskTypes = [] } = useTaskTypes();
  const { data: labelPickerData } = useListLabelPicker(listId, isOpen);

  const flatLabels = (labelPickerData?.groups || []).flatMap((g) => g.labels);

  const groupedTaskTypes = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const tt of taskTypes) {
      const g = getTaskTypeGroup(tt);
      const list = map.get(g) || [];
      list.push(tt);
      map.set(g, list);
    }
    const res: { groupName: string; items: any[] }[] = [];
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
  }, [taskTypes]);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialView) {
        setName(initialView.name || '');
        setViewType(initialView.view_type || 'list');
        const cfg = initialView.config || {};
        setKeywords(cfg.keywords || []);
        setIncludeInTimeReport(cfg.includeInTimeReport !== false);
        setDefaultPriority(cfg.defaultPriority || 'none');
        setDefaultTaskTypeId(cfg.defaultTaskTypeId || '');
        setDefaultLabel(cfg.defaultLabel || '');
        setShowAllTasks(!!cfg.showAllTasks);
      } else {
        setName('');
        setViewType('list');
        setKeywords([]);
        setKeywordInput('');
        setIncludeInTimeReport(true);
        setDefaultPriority('none');
        setDefaultTaskTypeId('');
        setDefaultLabel('');
        setShowAllTasks(false);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, mode, initialView]);

  if (!isOpen) return null;

  const handleAddKeyword = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const next = Array.from(new Set([...keywords, ...parts]));
    setKeywords(next);
    setKeywordInput('');
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    setKeywords(keywords.filter((k) => k !== kwToRemove));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddKeyword();
    } else if (e.key === 'Backspace' && !keywordInput && keywords.length > 0) {
      setKeywords(keywords.slice(0, -1));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || (viewType === 'board' ? 'Board' : viewType === 'whiteboard' ? 'Whiteboard' : 'List');

    // If there is un-entered text in the keyword input, include it
    let finalKeywords = [...keywords];
    if (keywordInput.trim()) {
      const parts = keywordInput.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
      finalKeywords = Array.from(new Set([...finalKeywords, ...parts]));
    }

    const prevConfig = initialView?.config || {};
    const updatedConfig: ListViewConfig = {
      ...prevConfig,
      keywords: finalKeywords,
      includeInTimeReport,
      defaultPriority: defaultPriority && defaultPriority !== 'none' ? defaultPriority : null,
      defaultTaskTypeId: defaultTaskTypeId ? defaultTaskTypeId : null,
      defaultLabel: defaultLabel ? defaultLabel : null,
      showAllTasks: finalKeywords.length === 0 ? showAllTasks : false,
    };

    onSave({
      name: finalName,
      view_type: viewType,
      config: updatedConfig,
      is_private: initialView?.is_private ?? false,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--sh-hair)] bg-[var(--surface)] p-6 shadow-2xl text-[var(--sh-ink)] overflow-hidden transition-all my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--sh-hair)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--sh-ink)]">
              {mode === 'create' ? 'Add New View' : 'Edit View Settings'}
            </h2>
            <p className="text-xs text-[var(--sh-ink-3)] mt-0.5">
              Customize keywords, time tracking, and default task attributes for this view.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--sh-ink-4)] hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)] transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* View Name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--sh-ink-3)] uppercase tracking-wider mb-1.5">
              View Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work, Personal, Fitness, Client Sync..."
              className="w-full rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-paper,var(--surface))] px-3.5 py-2 text-sm text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/15 transition"
              required
            />
          </div>

          {/* View Type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--sh-ink-3)] uppercase tracking-wider mb-1.5">
              View Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const isSelected = viewType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setViewType(opt.type)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition ${
                      isSelected
                        ? 'border-[#2962FF] bg-[#2962FF]/8 text-[#2962FF] shadow-sm font-semibold'
                        : 'border-[var(--sh-hair)] bg-[var(--sh-paper,var(--surface))] text-[var(--sh-ink-3)] hover:border-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]'
                    }`}
                  >
                    <span className="mb-1">{opt.icon}</span>
                    <span className="text-xs">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Keywords */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-[var(--sh-ink-3)] uppercase tracking-wider">
                Keywords Filter
              </label>
              <span className="text-[11px] text-[var(--sh-ink-4)]">Press Enter or comma</span>
            </div>
            <p className="text-xs text-[var(--sh-ink-4)] mb-2">
              If any task has these keywords, it will appear <strong>only</strong> in this view.
            </p>

            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-paper,var(--surface))] p-2 focus-within:border-[#2962FF] focus-within:ring-2 focus-within:ring-[#2962FF]/15 transition min-h-[42px]">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-md bg-[#2962FF]/12 text-[#2962FF] px-2 py-0.5 text-xs font-medium"
                >
                  <span>{kw}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(kw)}
                    className="hover:text-red-500 rounded p-0.5 transition"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                onBlur={handleAddKeyword}
                placeholder={keywords.length === 0 ? 'Type keyword (e.g. gym, bug, meeting) & Enter' : 'Add another...'}
                className="flex-1 min-w-[140px] bg-transparent text-xs text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none py-1 px-1"
              />
            </div>
          </div>

          {/* Time Report Toggle */}
          <div className="rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-paper,var(--surface))] p-3.5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeInTimeReport}
                onChange={(e) => setIncludeInTimeReport(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2962FF] focus:ring-[#2962FF]"
              />
              <div className="flex-1 text-left">
                <div className="text-xs font-semibold text-[var(--sh-ink)]">
                  Include in Time Report
                </div>
                <div className="text-[11px] text-[var(--sh-ink-3)] mt-0.5 leading-relaxed">
                  Include tasks and time tracked from this view in your daily timesheet and reports. Turn off for personal, non-work, or private view tasks.
                </div>
              </div>
            </label>
          </div>

          {/* Default Task Properties */}
          <div className="rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-paper,var(--surface))] p-3.5 space-y-3">
            <div className="text-xs font-semibold text-[var(--sh-ink)] flex items-center justify-between">
              <span>Default Task Settings</span>
              <span className="text-[10px] text-[var(--sh-ink-4)] font-normal">Auto-set for new tasks</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Default Priority */}
              <div>
                <label className="block text-[11px] font-medium text-[var(--sh-ink-3)] mb-1">
                  Default Priority
                </label>
                <select
                  value={defaultPriority}
                  onChange={(e) => setDefaultPriority(e.target.value)}
                  className="w-full rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--sh-ink)] outline-none focus:border-[#2962FF]"
                >
                  {STANDARD_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Default Task Type */}
              <div>
                <label className="block text-[11px] font-medium text-[var(--sh-ink-3)] mb-1">
                  Default Task Type
                </label>
                <select
                  value={defaultTaskTypeId}
                  onChange={(e) => setDefaultTaskTypeId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--sh-ink)] outline-none focus:border-[#2962FF]"
                >
                  <option value="">Default (None)</option>
                  {groupedTaskTypes.map((group) => (
                    <optgroup key={group.groupName} label={group.groupName}>
                      {group.items.map((tt: any) => (
                        <option key={tt.id} value={tt.id}>
                          {tt.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Default Label */}
              <div>
                <label className="block text-[11px] font-medium text-[var(--sh-ink-3)] mb-1">
                  Default Label
                </label>
                <select
                  value={defaultLabel}
                  onChange={(e) => setDefaultLabel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--sh-ink)] outline-none focus:border-[#2962FF]"
                >
                  <option value="">None</option>
                  {flatLabels.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Catch-all option when no keywords are set */}
          {keywords.length === 0 && (
            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--sh-ink-3)]">
                <input
                  type="checkbox"
                  checked={showAllTasks}
                  onChange={(e) => setShowAllTasks(e.target.checked)}
                  className="rounded border-gray-300 text-[#2962FF] focus:ring-[#2962FF]"
                />
                <span>Show all tasks (include tasks routed to other keyword views)</span>
              </label>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--sh-hair)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-xl bg-[#2962FF] hover:bg-[#1E54E4] text-white px-5 py-2 text-xs font-semibold shadow-sm transition disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : mode === 'create' ? 'Create View' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
