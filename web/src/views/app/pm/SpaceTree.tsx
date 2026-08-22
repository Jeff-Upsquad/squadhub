import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSpaces, useSpace, useWorkspaces, useCreateList } from '../../../hooks/useSpaces';
import { useSharedTree } from '../../../hooks/useSharedWithMe';
import { useIsPartner, useIsClient } from '../../../hooks/useUserType';
import { useHasPermission } from '../../../hooks/usePermissions';
import { usePMStore } from '../../../stores/pmStore';
import { useTabsStore } from '../../../stores/tabsStore';
import { wantsNewTab, buildListSnapshot, buildFolderSnapshot, buildDesignFolderSnapshot, buildSpaceSnapshot } from '../../../lib/tabSnapshots';
import CreateSpaceModal from './CreateSpaceModal';
import CreateFolderListModal from './CreateFolderListModal';
import CreateAreaSpaceModal from './CreateAreaSpaceModal';
import ManageMembersModal from './ManageMembersModal';
import SettingsSlider from '../../../components/SettingsSlider';
import { canAtLeast } from '../../../lib/access';
import { useReorderLists } from '../../../hooks/useSpaces';
import { isDesignReservedListName } from '../../../lib/designSpaceLists';
import type { Folder, List, AccessLevel, Space } from '@squadhub/shared';

// ---- Sibling list drag-reorder (HTML5 DnD, no library) ----
// One instance per sibling group (a folder's lists, or a space's root lists).
// Drop targets are siblings only, so a list can never be dragged into another
// container here — cross-folder moves stay with "Move list..." in settings.
interface ListDndProps {
  draggable: boolean;
  isDragging: boolean;
  isOverBefore: boolean;
  isOverAfter: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function useSiblingListDnD(
  siblingIds: string[],
  enabled: boolean,
  commit: (orderedIds: string[]) => void,
): { propsFor: (list: List) => ListDndProps } {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

  const clear = () => {
    setDragId(null);
    setOver(null);
  };

  const reorder = (targetId: string, pos: 'before' | 'after') => {
    if (!dragId || dragId === targetId) {
      clear();
      return;
    }
    const ids = [...siblingIds];
    const from = ids.indexOf(dragId);
    let to = ids.indexOf(targetId) + (pos === 'before' ? 0 : 1);
    if (from < to) to -= 1; // account for the removal shift
    if (from !== -1 && to !== -1 && from !== to) {
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      if (ids.some((id, i) => id !== siblingIds[i])) commit(ids);
    }
    clear();
  };

  const propsFor = (list: List): ListDndProps => ({
    // Only admin-locked lists are frozen; private ones reorder fine for
    // people who already manage this container (server enforces manager).
    draggable: enabled && !list.is_locked,
    isDragging: dragId === list.id,
    isOverBefore: over?.id === list.id && over.pos === 'before',
    isOverAfter: over?.id === list.id && over.pos === 'after',
    onDragStart: () => {
      if (enabled && !list.is_locked) setDragId(list.id);
    },
    onDragOver: (e) => {
      if (!dragId || !enabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setOver((prev) => (prev && prev.id === list.id && prev.pos === pos ? prev : { id: list.id, pos }));
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      reorder(list.id, over?.id === list.id ? over.pos : 'after');
    },
    onDragEnd: clear,
  });

  return { propsFor };
}

// ---- Lock icon for private items ----
function LockIcon() {
  return (
    <svg className="h-3 w-3 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

// ---- Admin lock icon (resource locked by admin) ----
function AdminLockIcon() {
  return (
    <svg className="h-3 w-3 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  );
}

// ---- Small triangle chevron (matches client row style) ----
function TriangleChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${open ? '' : '-rotate-90'}`}
      viewBox="0 0 18 18"
      fill="currentColor"
    >
      <path d="M5 7h8L9 11z" />
    </svg>
  );
}

// ---- List icon ----
function ListIconSmall() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

// ---- Folder icon ----
function FolderIconSmall() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

// ---- Ellipsis menu button ----
function EllipsisButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
      title={title}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="6" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="18" r="1.5" />
      </svg>
    </button>
  );
}

// ---- Add button ----
function AddButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
      title={title}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}

// ---- Dropdown menu for add actions ----
function AddDropdown({
  items,
}: {
  items: { icon: React.ReactNode; label: string; description: string; onClick: () => void }[];
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuHeight = items.length * 52 + 32; // approximate
      const fitsBelow = rect.bottom + 4 + menuHeight < window.innerHeight;
      setPos({
        top: fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4,
        left: rect.right - 224,
      });
    }
    setOpen(!open);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
        title="Add"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed z-[100] w-56 rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-1 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--sh-ink-4)]">Create</div>
          {items.map((item) => (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--sh-hair-3)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--sh-hair-3)] text-[var(--sh-ink-4)]">{item.icon}</span>
              <div>
                <div className="text-[13px] font-medium text-[var(--sh-ink)]">{item.label}</div>
                <div className="text-[11px] text-[var(--sh-ink-4)]">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// Icons for dropdown items
const DropdownListIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);
const DropdownFolderIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);
const DropdownSpaceIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);
const DropdownClientIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z" />
  </svg>
);

// ---- List item ----
function ListItem({ list, isManager = false, myAccess, dnd }: { list: List; isManager?: boolean; myAccess?: AccessLevel | null; dnd?: ListDndProps }) {
  const { activeListId, setActiveList, setActiveSpace } = usePMStore();
  const [showSettings, setShowSettings] = useState(false);
  const isActive = activeListId === list.id;
  const openList = (e?: React.MouseEvent) => {
    if (e && wantsNewTab(e)) {
      e.preventDefault();
      useTabsStore.getState().openInNewTab(buildListSnapshot(list.space_id, list.id), { background: e.button === 1 });
      return;
    }
    setActiveSpace(list.space_id);
    setActiveList(list.id);
  };

  const rowStyle: React.CSSProperties = {};
  if (isActive) rowStyle.boxShadow = 'var(--sh-shadow-sm)';
  if (dnd?.isDragging) rowStyle.opacity = 0.4;
  if (dnd?.isOverBefore) rowStyle.boxShadow = 'inset 0 2px 0 var(--sh-ink)';
  else if (dnd?.isOverAfter) rowStyle.boxShadow = 'inset 0 -2px 0 var(--sh-ink)';

  return (
    <>
      {/* role=button div (not <button>) so the nested settings button is valid HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={openList}
        onAuxClick={(e) => { if (e.button === 1) openList(e); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); } }}
        draggable={dnd?.draggable}
        onDragStart={dnd ? () => dnd.onDragStart() : undefined}
        onDragOver={dnd?.onDragOver}
        onDrop={dnd?.onDrop}
        onDragEnd={dnd?.onDragEnd}
        className={`sh-tree-row flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
          dnd?.draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${
          isActive
            ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
            : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
        }`}
        style={rowStyle}
      >
        <span className={`shrink-0 ${isActive ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}>
          <ListIconSmall />
        </span>
        <span className="flex-1 truncate">{list.name}</span>
        {list.is_locked && <AdminLockIcon />}
        {list.is_private && !list.is_locked && <LockIcon />}
        {list.task_count != null && list.task_count > 0 && (
          <span className="rounded-full bg-[var(--sh-hair-3)] px-1.5 py-[1px] text-[10.5px] font-medium leading-none text-[var(--sh-ink-4)] tabular-nums">
            {list.task_count}
          </span>
        )}
        {isManager && !list.is_locked && (
          <EllipsisButton onClick={() => setShowSettings(true)} title="List settings" />
        )}
      </div>

      {showSettings && typeof document !== 'undefined' && createPortal((
        <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSettings(false)} />
        <div className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <SettingsSlider type="list" id={list.id} name={list.name} spaceId={list.space_id} folderId={list.folder_id} groupTasks={list.group_tasks} autoAssigneeIds={list.auto_assignee_ids} myAccess={myAccess} onClose={() => setShowSettings(false)} />
        </div>
        </>
      ), document.body)}
    </>
  );
}

// ---- Inline name input ----
function InlineInput({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const submitted = useRef(false);

  const handleSubmit = useCallback(() => {
    if (submitted.current) return;
    if (!value.trim()) { onCancel(); return; }
    submitted.current = true;
    onSubmit(value.trim());
  }, [value, onSubmit, onCancel]);

  return (
    <div className="py-1 pl-3 pr-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
        onBlur={handleSubmit}
        placeholder={placeholder}
        className="w-full rounded-[6px] border border-[var(--sh-hair)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none transition focus:border-[var(--sh-ink-4)]"
      />
    </div>
  );
}

// ---- Space icon for template-based spaces ----
function SpaceIconSmall() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  );
}

// ---- Folder item ----
function FolderItem({ folder, spaceId, canAdd, canDelete, isManager, myAccess }: { folder: Folder; spaceId: string; canAdd: boolean; canDelete: boolean; isManager: boolean; myAccess?: AccessLevel | null }) {
  const { activeFolderId, activeDesignFolderId, setActiveFolder, setActiveSpace, setActiveDesignFolder } = usePMStore();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const createList = useCreateList(spaceId);
  const reorderLists = useReorderLists();
  const isTemplateSpace = !!folder.client_space_template_id;
  const isActive = isTemplateSpace ? activeDesignFolderId === folder.id : activeFolderId === folder.id;
  // Drag-reorder among this folder's sibling lists. Disabled for template
  // spaces: their reserved status lists are hidden from the tree but still live
  // in the container, so a visible-subset order couldn't be persisted safely.
  const listDnd = useSiblingListDnD(
    (folder.lists ?? []).map((l) => l.id),
    isManager && !folder.is_locked && !isTemplateSpace,
    (orderedIds) => reorderLists.mutate({ space_id: spaceId, folder_id: folder.id, ordered_ids: orderedIds }),
  );
  const openFolder = (e?: React.MouseEvent) => {
    if (e && wantsNewTab(e)) {
      e.preventDefault();
      const snap = isTemplateSpace
        ? buildDesignFolderSnapshot(spaceId, folder.id)
        : buildFolderSnapshot(spaceId, folder.id);
      useTabsStore.getState().openInNewTab(snap, { background: e.button === 1 });
      return;
    }
    setActiveSpace(spaceId);
    isTemplateSpace ? setActiveDesignFolder(folder.id) : setActiveFolder(folder.id);
  };

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <TriangleChevron open={open} />
        </button>
        <button
          onClick={openFolder}
          onAuxClick={(e) => { if (e.button === 1) openFolder(e); }}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-[5px] py-[5px] text-left text-[13px] transition ${
            isActive
              ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
              : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
          }`}
          style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
        >
          <span className={`shrink-0 ${isActive ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}>
            {isTemplateSpace ? <SpaceIconSmall /> : <FolderIconSmall />}
          </span>
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="mr-1 hidden items-center gap-0.5 group-hover:flex">
          {folder.is_locked && <AdminLockIcon />}
          {folder.is_private && !folder.is_locked && <LockIcon />}
          {canDelete && !folder.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title={isTemplateSpace ? 'Space settings' : 'Folder settings'} />}
          {canAdd && !folder.is_locked && <AddButton onClick={() => setAdding(true)} title="Add list" />}
        </div>
      </div>

      {open && (
        <div className="pb-1 pl-8 pr-2">
          {/* Template-based spaces seed status lists (Briefs / In Progress / Reviews /
              Completed) plus a general "Tasks" list — all surface as views inside the
              Design Space page, not as sidebar children. Hide those; show only lists
              the user added manually. */}
          {(isTemplateSpace
            ? folder.lists?.filter((list) => !isDesignReservedListName(list.name))
            : folder.lists
          )?.map((list) => (
            <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} dnd={listDnd.propsFor(list)} />
          ))}
          {adding && (
            <InlineInput
              placeholder="List name..."
              onSubmit={(name) => {
                createList.mutate({ name, folder_id: folder.id }, {
                  onSuccess: () => setAdding(false),
                  onError: (err: any) => { console.error('Create list in folder error:', err?.response?.data || err); setAdding(false); },
                });
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </div>
      )}

      {showSettings && typeof document !== 'undefined' && createPortal((
        <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSettings(false)} />
        <div className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <SettingsSlider type="folder" id={folder.id} name={folder.name} spaceId={spaceId} groupTasks={folder.group_tasks} autoAssigneeIds={folder.auto_assignee_ids} myAccess={myAccess} onClose={() => setShowSettings(false)} />
        </div>
        </>
      ), document.body)}
    </div>
  );
}

// ---- Person icon for client folders ----
function PersonIconSmall() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

// ---- Client folder item ----
function ClientItem({ folder, childSpaces, spaceId, canAddLists, canAddSpaces, canDelete, isManager, myAccess }: {
  folder: Folder;
  childSpaces: Folder[];
  spaceId: string;
  canAddLists: boolean;
  canAddSpaces: boolean;
  canDelete: boolean;
  isManager: boolean;
  myAccess?: AccessLevel | null;
}) {
  const { activeFolderId, setActiveFolder, setActiveSpace } = usePMStore();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isActive = activeFolderId === folder.id;

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <TriangleChevron open={open} />
        </button>
        <button
          onClick={() => { setActiveSpace(spaceId); setActiveFolder(folder.id); }}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-[5px] py-[5px] text-left text-[13px] transition ${
            isActive
              ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
              : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
          }`}
          style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
        >
          <span className={`shrink-0 ${isActive ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}>
            <PersonIconSmall />
          </span>
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="mr-1 hidden items-center gap-0.5 group-hover:flex">
          {folder.is_locked && <AdminLockIcon />}
          {folder.is_private && !folder.is_locked && <LockIcon />}
          {canDelete && !folder.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Client settings" />}
          {canAddSpaces && !folder.is_locked && <AddButton onClick={() => setAdding(true)} title="Add space" />}
        </div>
      </div>

      {open && (
        <div className="pb-1 pl-8 pr-2">
          {childSpaces.map(spaceFolder => (
            <FolderItem key={spaceFolder.id} folder={spaceFolder} spaceId={spaceId} canAdd={canAddLists} canDelete={canDelete} isManager={isManager} myAccess={myAccess} />
          ))}
          {adding && (
            <CreateAreaSpaceModal
              spaceId={spaceId}
              parentFolderId={folder.id}
              onClose={() => setAdding(false)}
            />
          )}
        </div>
      )}

      {showSettings && typeof document !== 'undefined' && createPortal((
        <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSettings(false)} />
        <div className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <SettingsSlider type="folder" id={folder.id} name={folder.name} spaceId={spaceId} groupTasks={folder.group_tasks} autoAssigneeIds={folder.auto_assignee_ids} myAccess={myAccess} onClose={() => setShowSettings(false)} />
        </div>
        </>
      ), document.body)}
    </div>
  );
}

// ---- Space item ----
function SpaceItem({ spaceId, initial }: { spaceId: string; initial?: Space }) {
  const { activeSpaceId, activeSpacePageId, setActiveSpace, setActiveSpacePage } = usePMStore();
  const isActive = activeSpaceId === spaceId;
  const isSpacePageActive = activeSpacePageId === spaceId;
  const [open, setOpen] = useState(false);
  const [createModal, setCreateModal] = useState<'folder' | 'list' | 'space' | 'client' | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const canCreateFolders = useHasPermission('can_create_folders');
  const canCreateLists = useHasPermission('can_create_lists');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const reorderLists = useReorderLists();

  const { data: fullSpace } = useSpace(isActive || open ? spaceId : null);
  const space = fullSpace || initial;

  const myAccess = space?.my_access_level;
  const canAddItems = canAtLeast(myAccess, 'member');
  const isManager = canAtLeast(myAccess, 'manager');

  // Drag-reorder among the space's root-level (folderless) lists.
  const rootListDnd = useSiblingListDnD(
    (space?.lists ?? []).map((l) => l.id),
    isManager && !space?.is_locked,
    (orderedIds) => reorderLists.mutate({ space_id: spaceId, folder_id: null, ordered_ids: orderedIds }),
  );

  const handleRowClick = (e?: React.MouseEvent) => {
    if (e && wantsNewTab(e)) {
      e.preventDefault();
      useTabsStore.getState().openInNewTab(buildSpaceSnapshot(spaceId), { background: e.button === 1 });
      return;
    }
    setActiveSpace(spaceId);
    setActiveSpacePage(spaceId);
    setOpen(true);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(!open);
  };

  const isRowActive = isSpacePageActive || (isActive && open);

  return (
    <div className="px-2">
      <div className="group flex items-center">
        <button
          onClick={handleToggle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <TriangleChevron open={open} />
        </button>
        <button
          onClick={handleRowClick}
          onAuxClick={(e) => { if (e.button === 1) handleRowClick(e); }}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-[5px] py-[5px] text-left text-[13px] transition ${
            isRowActive
              ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
              : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
          }`}
          style={isRowActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--sh-hair-3)] text-[9px] font-semibold uppercase text-[var(--sh-ink-2)]">
            {space?.name?.slice(0, 2).toUpperCase() || 'S'}
          </span>
          <span className="truncate">{space?.name || 'Loading...'}</span>
        </button>
        <div className="mr-1 hidden items-center gap-0.5 group-hover:flex">
          {space?.is_locked && <AdminLockIcon />}
          {space?.is_private && !space?.is_locked && <LockIcon />}
          {isManager && !space?.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Area settings" />}
          {canAddItems && !space?.is_locked && (canCreateFolders || canCreateLists || canCreateSpaces) && (
            <AddDropdown
              items={[
                ...(canCreateLists ? [{
                  icon: DropdownListIcon,
                  label: 'List',
                  description: 'Track tasks, projects, people & more',
                  onClick: () => setCreateModal('list'),
                }] : []),
                ...(canCreateSpaces ? [{
                  icon: DropdownSpaceIcon,
                  label: 'Space',
                  description: 'Designer Space, Video Editor Space & more',
                  onClick: () => setCreateModal('space'),
                }] : []),
                ...(canCreateFolders ? [{
                  icon: DropdownClientIcon,
                  label: 'Client',
                  description: 'Group template-based spaces for a client',
                  onClick: () => setCreateModal('client'),
                }] : []),
                ...(canCreateFolders ? [{
                  icon: DropdownFolderIcon,
                  label: 'Folder',
                  description: 'Group Lists, Docs & more',
                  onClick: () => setCreateModal('folder'),
                }] : []),
              ]}
            />
          )}
        </div>
      </div>

      {open && space && (
        <div className="pb-1 pl-8 pr-2">
          {(() => {
            // Build folder hierarchy
            const allFolders = space.folders || [];

            // Group child folders (spaces) by parent_folder_id
            const childFolders: Record<string, Folder[]> = {};
            const rootFolders: Folder[] = [];
            for (const f of allFolders) {
              if (f.parent_folder_id) {
                if (!childFolders[f.parent_folder_id]) childFolders[f.parent_folder_id] = [];
                childFolders[f.parent_folder_id].push(f);
              } else {
                rootFolders.push(f);
              }
            }

            // Render: clients first, then other folders, then standalone spaces
            const clientFolders = rootFolders.filter(f => f.folder_type === 'client');
            const otherRootFolders = rootFolders.filter(f => f.folder_type !== 'client' && !f.client_space_template_id);
            const standaloneSpaces = rootFolders.filter(f => f.client_space_template_id);

            return (
              <>
                {clientFolders.map(folder => (
                  <ClientItem
                    key={folder.id}
                    folder={folder}
                    childSpaces={childFolders[folder.id] || []}
                    spaceId={spaceId}
                    canAddLists={canAddItems && canCreateLists}
                    canAddSpaces={canAddItems && canCreateSpaces}
                    canDelete={isManager}
                    isManager={isManager}
                    myAccess={myAccess}
                  />
                ))}
                {otherRootFolders.map(folder => (
                  <FolderItem key={folder.id} folder={folder} spaceId={spaceId} canAdd={canAddItems && canCreateLists} canDelete={isManager} isManager={isManager} myAccess={myAccess} />
                ))}
                {standaloneSpaces.map(folder => (
                  <FolderItem key={folder.id} folder={folder} spaceId={spaceId} canAdd={canAddItems && canCreateLists} canDelete={isManager} isManager={isManager} myAccess={myAccess} />
                ))}
                {space.lists?.map((list) => (
                  <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} dnd={rootListDnd.propsFor(list)} />
                ))}
              </>
            );
          })()}
          {createModal && createModal !== 'space' && createModal !== 'client' && (
            <CreateFolderListModal
              type={createModal}
              spaceId={spaceId}
              onClose={() => setCreateModal(null)}
            />
          )}
          {createModal === 'client' && (
            <CreateFolderListModal
              type="client"
              spaceId={spaceId}
              onClose={() => setCreateModal(null)}
            />
          )}
          {createModal === 'space' && (
            <CreateAreaSpaceModal
              spaceId={spaceId}
              onClose={() => setCreateModal(null)}
            />
          )}
        </div>
      )}

      {showMembers && (
        <ManageMembersModal
          resourceType="space"
          resourceId={spaceId}
          resourceName={space?.name || 'Space'}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showSettings && space && typeof document !== 'undefined' && createPortal((
        <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSettings(false)} />
        <div className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <SettingsSlider type="space" id={spaceId} name={space.name} description={space.description} groupTasks={space.group_tasks} autoAssigneeIds={space.auto_assignee_ids} myAccess={myAccess} onClose={() => setShowSettings(false)} />
        </div>
        </>
      ), document.body)}
    </div>
  );
}

// ---- Workspace root (Workspaces section) ----
// A workspace space renders only its children (client folders, template spaces
// and root lists) — no "Client Spaces" wrapper row. The wrapper row is gone,
// so the client folders are the top-level items under Workspaces.
function WorkspaceRoot({ workspaceId }: { workspaceId: string }) {
  const { data: fullSpace } = useSpace(workspaceId);
  const canCreateLists = useHasPermission('can_create_lists');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const reorderLists = useReorderLists();

  const space = fullSpace;

  // Drag-reorder among the workspace's root-level (folderless) lists.
  // Kept above the loading guard — hooks can't sit behind an early return.
  const rootListDnd = useSiblingListDnD(
    (space?.lists ?? []).map((l) => l.id),
    !!space && canAtLeast(space.my_access_level, 'manager') && !space.is_locked,
    (orderedIds) => reorderLists.mutate({ space_id: workspaceId, folder_id: null, ordered_ids: orderedIds }),
  );

  if (!space) return null;

  const myAccess = space.my_access_level;
  const canAddItems = canAtLeast(myAccess, 'member');
  const isManager = canAtLeast(myAccess, 'manager');

  const allFolders = space.folders || [];
  const childFolders: Record<string, Folder[]> = {};
  const rootFolders: Folder[] = [];
  for (const f of allFolders) {
    if (f.parent_folder_id) {
      if (!childFolders[f.parent_folder_id]) childFolders[f.parent_folder_id] = [];
      childFolders[f.parent_folder_id].push(f);
    } else {
      rootFolders.push(f);
    }
  }

  const clientFolders = rootFolders.filter((f) => f.folder_type === 'client');
  const otherRootFolders = rootFolders.filter((f) => f.folder_type !== 'client' && !f.client_space_template_id);
  const standaloneSpaces = rootFolders.filter((f) => f.client_space_template_id);

  return (
    <div className="px-1.5">
      {clientFolders.map((folder) => (
        <ClientItem
          key={folder.id}
          folder={folder}
          childSpaces={childFolders[folder.id] || []}
          spaceId={workspaceId}
          canAddLists={canAddItems && canCreateLists}
          canAddSpaces={canAddItems && canCreateSpaces}
          canDelete={isManager}
          isManager={isManager}
          myAccess={myAccess}
        />
      ))}
      {otherRootFolders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          spaceId={workspaceId}
          canAdd={canAddItems && canCreateLists}
          canDelete={isManager}
          isManager={isManager}
          myAccess={myAccess}
        />
      ))}
      {standaloneSpaces.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          spaceId={workspaceId}
          canAdd={canAddItems && canCreateLists}
          canDelete={isManager}
          isManager={isManager}
          myAccess={myAccess}
        />
      ))}
      {space.lists?.map((list) => (
        <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} dnd={rootListDnd.propsFor(list)} />
      ))}
    </div>
  );
}

// ---- Workspaces tree ----
export function WorkspaceTree({ workspaceId }: { workspaceId: string }) {
  const { data: workspaces, isLoading } = useWorkspaces(workspaceId);

  if (isLoading) {
    return <p className="px-3 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading…</p>;
  }

  if (!workspaces || workspaces.length === 0) {
    return <p className="px-3 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No workspaces yet</p>;
  }

  return (
    <div className="flex w-full flex-col">
      {workspaces.map((workspace) => (
        <WorkspaceRoot key={workspace.id} workspaceId={workspace.id} />
      ))}
    </div>
  );
}

// ---- Partner / client shared roots ----
// Partner-tier and client users have no space-level membership, so their shared
// client folders, design spaces and lists are surfaced here as top-level AREAS
// roots (flattened — the parent area they can't see is never shown).
// Create/add affordances stay off: these users only ever view what was shared.
function PartnerSharedRoots({ workspaceId }: { workspaceId: string }) {
  const { data: tree } = useSharedTree(workspaceId, true);

  if (!tree) return null;
  const { clientFolders, folders, lists } = tree;
  if (!clientFolders.length && !folders.length && !lists.length) return null;

  return (
    <div className="px-1.5">
      {clientFolders.map((folder) => {
        const isManager = canAtLeast(folder.my_access_level, 'manager');
        return (
          <ClientItem
            key={folder.id}
            folder={folder}
            childSpaces={folder.childSpaces}
            spaceId={folder.space_id}
            canAddLists={false}
            canAddSpaces={false}
            canDelete={isManager}
            isManager={isManager}
            myAccess={folder.my_access_level}
          />
        );
      })}
      {folders.map((folder) => {
        const isManager = canAtLeast(folder.my_access_level, 'manager');
        return (
          <FolderItem
            key={folder.id}
            folder={folder}
            spaceId={folder.space_id}
            canAdd={false}
            canDelete={isManager}
            isManager={isManager}
            myAccess={folder.my_access_level}
          />
        );
      })}
      {lists.map((list) => (
        <ListItem
          key={list.id}
          list={list}
          isManager={canAtLeast(list.my_access_level, 'manager')}
          myAccess={list.my_access_level}
        />
      ))}
    </div>
  );
}

// ---- Main SpaceTree ----
export default function SpaceTree({ workspaceId, onRequestCreate }: { workspaceId: string; onRequestCreate?: () => void }) {
  const isPartner = useIsPartner();
  const isClient = useIsClient();
  // Clients aren't allowed on GET /pm/spaces (internal/partner-only) and own no
  // areas — skip the fetch (it would 403) and rely on their shared roots below.
  const { data: spaces, isLoading } = useSpaces(isClient ? undefined : workspaceId);
  const [showCreate, setShowCreate] = useState(false);
  const canCreateSpaces = useHasPermission('can_create_spaces');

  const handleCreate = () => {
    if (onRequestCreate) onRequestCreate();
    else setShowCreate(true);
  };

  return (
    <div className="flex w-full flex-col">
      <div className="px-1.5">
        {isLoading && (
          <p className="px-3 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading…</p>
        )}
        {/* Partners and clients have no owned/member areas — their shared roots
            render below, so suppress the internal "No areas yet / create" empty
            state for them. */}
        {spaces?.length === 0 && !isLoading && !isPartner && !isClient && (
          <div className="px-3 py-2 text-center">
            <p className="text-[11.5px] text-[var(--sh-ink-4)]">No areas yet</p>
            {canCreateSpaces && (
              <button
                onClick={handleCreate}
                className="mt-2 text-[11.5px] font-medium text-[var(--sh-ink-2)] hover:text-[var(--sh-ink)]"
              >
                Create your first area
              </button>
            )}
          </div>
        )}
        {spaces?.map((space) => (
          <SpaceItem key={space.id} spaceId={space.id} initial={space} />
        ))}
      </div>

      {(isPartner || isClient) && <PartnerSharedRoots workspaceId={workspaceId} />}

      {showCreate && (
        <CreateSpaceModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
