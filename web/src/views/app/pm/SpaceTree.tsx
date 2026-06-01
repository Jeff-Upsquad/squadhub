import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSpaces, useSpace, useCreateList } from '../../../hooks/useSpaces';
import { useHasPermission } from '../../../hooks/usePermissions';
import { usePMStore } from '../../../stores/pmStore';
import CreateSpaceModal from './CreateSpaceModal';
import CreateFolderListModal from './CreateFolderListModal';
import ManageMembersModal from './ManageMembersModal';
import SettingsSlider from '../../../components/SettingsSlider';
import { canAtLeast } from '../../../lib/access';
import type { Folder, List, AccessLevel, Space } from '@squadhub/shared';

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

// ---- List item ----
function ListItem({ list, isManager = false, myAccess }: { list: List; isManager?: boolean; myAccess?: AccessLevel | null }) {
  const { activeListId, setActiveList, setActiveSpace } = usePMStore();
  const [showSettings, setShowSettings] = useState(false);
  const isActive = activeListId === list.id;

  return (
    <>
      <button
        onClick={() => { setActiveSpace(list.space_id); setActiveList(list.id); }}
        className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
          isActive
            ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
            : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
        }`}
        style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
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
      </button>

      {showSettings && typeof document !== 'undefined' && createPortal((
        <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowSettings(false)} />
        <div className="fixed inset-y-0 right-0 left-auto z-50 flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--sh-hair)] bg-[var(--surface)] shadow-lg" onClick={(e) => e.stopPropagation()}>
          <SettingsSlider type="list" id={list.id} name={list.name} spaceId={list.space_id} folderId={list.folder_id} myAccess={myAccess} onClose={() => setShowSettings(false)} />
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

// ---- Folder item ----
function FolderItem({ folder, spaceId, canAdd, canDelete, isManager, myAccess }: { folder: Folder; spaceId: string; canAdd: boolean; canDelete: boolean; isManager: boolean; myAccess?: AccessLevel | null }) {
  const { activeFolderId, setActiveFolder, setActiveSpace } = usePMStore();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const createList = useCreateList(spaceId);
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
            <FolderIconSmall />
          </span>
          <span className="truncate">{folder.name}</span>
        </button>
        <div className="mr-1 hidden items-center gap-0.5 group-hover:flex">
          {folder.is_locked && <AdminLockIcon />}
          {folder.is_private && !folder.is_locked && <LockIcon />}
          {canDelete && !folder.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Folder settings" />}
          {canAdd && !folder.is_locked && <AddButton onClick={() => setAdding(true)} title="Add list" />}
        </div>
      </div>

      {open && (
        <div className="pb-1 pl-8 pr-2">
          {folder.lists?.map((list) => (
            <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} />
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
          <SettingsSlider type="folder" id={folder.id} name={folder.name} spaceId={spaceId} myAccess={myAccess} onClose={() => setShowSettings(false)} />
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
  const [createModal, setCreateModal] = useState<'folder' | 'list' | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const canCreateFolders = useHasPermission('can_create_folders');
  const canCreateLists = useHasPermission('can_create_lists');

  const { data: fullSpace } = useSpace(isActive || open ? spaceId : null);
  const space = fullSpace || initial;

  const myAccess = space?.my_access_level;
  const canAddItems = canAtLeast(myAccess, 'member');
  const isManager = canAtLeast(myAccess, 'manager');

  const handleRowClick = () => {
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
          {isManager && !space?.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Space settings" />}
          {canAddItems && !space?.is_locked && (canCreateFolders || canCreateLists) && (
            <AddDropdown
              items={[
                ...(canCreateLists ? [{
                  icon: DropdownListIcon,
                  label: 'List',
                  description: 'Track tasks, projects, people & more',
                  onClick: () => setCreateModal('list'),
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
          {space.folders?.map((folder) => (
            <FolderItem key={folder.id} folder={folder} spaceId={spaceId} canAdd={canAddItems && canCreateLists} canDelete={isManager} isManager={isManager} myAccess={myAccess} />
          ))}
          {space.lists?.map((list) => (
            <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} />
          ))}
          {createModal && (
            <CreateFolderListModal
              type={createModal}
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
          <SettingsSlider type="space" id={spaceId} name={space.name} description={space.description} myAccess={myAccess} onClose={() => setShowSettings(false)} />
        </div>
        </>
      ), document.body)}
    </div>
  );
}

// ---- Main SpaceTree ----
export default function SpaceTree({ workspaceId, onRequestCreate }: { workspaceId: string; onRequestCreate?: () => void }) {
  const { data: spaces, isLoading } = useSpaces(workspaceId);
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
        {spaces?.length === 0 && !isLoading && (
          <div className="px-3 py-2 text-center">
            <p className="text-[11.5px] text-[var(--sh-ink-4)]">No spaces yet</p>
            {canCreateSpaces && (
              <button
                onClick={handleCreate}
                className="mt-2 text-[11.5px] font-medium text-[var(--sh-ink-2)] hover:text-[var(--sh-ink)]"
              >
                Create your first space
              </button>
            )}
          </div>
        )}
        {spaces?.map((space) => (
          <SpaceItem key={space.id} spaceId={space.id} initial={space} />
        ))}
      </div>

      {showCreate && (
        <CreateSpaceModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
