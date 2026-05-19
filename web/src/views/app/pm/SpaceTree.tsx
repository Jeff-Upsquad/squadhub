import { useState, useRef, useEffect, useCallback } from 'react';
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
    <svg className="h-3 w-3 shrink-0 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

// ---- Vertical chevron (space/folder rows) — points down when closed, up when open ----
function ChevronVertical({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-[#999999] transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ---- Right chevron (list rows — decorative) ----
function ChevronRight() {
  return (
    <svg
      className="h-3 w-3 shrink-0 text-[#B0B0B0]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ---- Small horizontal tree branch stub ----
function TreeBranch() {
  return <span className="pointer-events-none absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-[#E5E5E5]" aria-hidden />;
}

// ---- Ellipsis menu button ----
function EllipsisButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded p-0.5 text-[#999999] opacity-0 transition hover:text-[#0F172B] group-hover:opacity-100"
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
      className="rounded p-0.5 text-[#999999] opacity-0 transition hover:text-[#0F172B] group-hover:opacity-100"
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
        className="rounded p-0.5 text-[#999999] opacity-0 transition hover:text-[#0F172B] group-hover:opacity-100"
        title="Add"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed z-[100] w-56 rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[#999999]">Create</div>
          {items.map((item) => (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#F5F5F5]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F1F5F9] text-[#64748B]">{item.icon}</span>
              <div>
                <div className="text-[13px] font-medium text-[#0F172B]">{item.label}</div>
                <div className="text-[11px] text-[#999999]">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// Icons for dropdown items
const ListIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);
const FolderIcon = (
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
      <div
        onClick={() => { setActiveSpace(list.space_id); setActiveList(list.id); }}
        className={`group relative flex w-full cursor-pointer items-center gap-2 rounded-md py-[5px] pl-3 pr-2 text-left text-[13px] transition ${
          isActive
            ? 'bg-white text-[#0F172B] font-medium shadow-[0_1px_3px_rgba(15,23,43,0.08),0_0_0_1px_rgba(15,23,43,0.06)]'
            : 'text-[#555555] hover:bg-[#F5F5F5]'
        }`}
      >
        <TreeBranch />
        <span className="flex-1 truncate">{list.name}</span>
        {list.is_locked && <AdminLockIcon />}
        {list.is_private && !list.is_locked && <LockIcon />}
        <div className="flex items-center gap-0.5">
          {isManager && !list.is_locked && (
            <EllipsisButton onClick={() => setShowSettings(true)} title="List settings" />
          )}
        </div>
        {list.task_count != null && list.task_count > 0 && (
          <span className="rounded-full bg-[#F1F1F1] px-1.5 py-[1px] text-[10.5px] font-medium leading-none text-[#666666] tabular-nums">
            {list.task_count}
          </span>
        )}
        <ChevronRight />
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsSlider type="list" id={list.id} name={list.name} spaceId={list.space_id} folderId={list.folder_id} myAccess={myAccess} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
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
        className="w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-1 text-xs text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
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
      <div
        onClick={() => { setActiveSpace(spaceId); setActiveFolder(folder.id); }}
        className={`group relative flex cursor-pointer items-center rounded-md py-[5px] pl-3 pr-2 transition ${
          isActive
            ? 'bg-white text-[#0F172B] font-medium shadow-[0_1px_3px_rgba(15,23,43,0.08),0_0_0_1px_rgba(15,23,43,0.06)]'
            : 'hover:bg-[#F5F5F5]'
        }`}
      >
        <TreeBranch />
        <div className={`flex flex-1 items-center gap-2 text-left text-[13px] ${isActive ? 'text-[#0F172B]' : 'text-[#555555]'}`}>
          {/* Folder icon */}
          <svg className="h-4 w-4 shrink-0 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="flex-1 truncate">{folder.name}</span>
        </div>
        {folder.is_locked && <AdminLockIcon />}
        {folder.is_private && !folder.is_locked && <LockIcon />}
        <div className="flex items-center gap-0.5">
          {canDelete && !folder.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Folder settings" />}
          {canAdd && !folder.is_locked && <AddButton onClick={() => setAdding(true)} title="Add list" />}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="ml-1 flex items-center"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
        >
          <ChevronVertical open={open} />
        </button>
      </div>

      {open && (
        <div className="relative ml-3 border-l border-[#E5E5E5]">
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

      {showSettings && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsSlider type="folder" id={folder.id} name={folder.name} spaceId={spaceId} myAccess={myAccess} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
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

  return (
    <div className="mb-0.5">
      {/* Space row */}
      <div
        onClick={handleRowClick}
        className={`group flex cursor-pointer items-center rounded-md py-[6px] pl-3 pr-2 transition ${
          isSpacePageActive || (isActive && open)
            ? 'bg-white shadow-[0_1px_3px_rgba(15,23,43,0.08),0_0_0_1px_rgba(15,23,43,0.06)]'
            : 'hover:bg-[#F5F5F5]'
        }`}
      >
        <div className="flex flex-1 items-center gap-2 text-left">
          {/* Color badge */}
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded text-[11px] font-bold text-white"
            style={{ backgroundColor: space?.color || '#7c3aed' }}
          >
            {space?.name?.[0]?.toUpperCase() || 'S'}
          </span>
          <span className={`truncate text-[13px] ${isSpacePageActive || (isActive && open) ? 'font-semibold text-[#0F172B]' : 'font-medium text-[#444444]'}`}>
            {space?.name || 'Loading...'}
          </span>
        </div>

        {space?.is_locked && <AdminLockIcon />}
        {space?.is_private && !space?.is_locked && <LockIcon />}

        <div className="flex items-center gap-0.5">
          {isManager && !space?.is_locked && <EllipsisButton onClick={() => setShowSettings(true)} title="Space settings" />}
          {canAddItems && !space?.is_locked && (canCreateFolders || canCreateLists) && (
            <AddDropdown
              items={[
                ...(canCreateLists ? [{
                  icon: ListIcon,
                  label: 'List',
                  description: 'Track tasks, projects, people & more',
                  onClick: () => setCreateModal('list'),
                }] : []),
                ...(canCreateFolders ? [{
                  icon: FolderIcon,
                  label: 'Folder',
                  description: 'Group Lists, Docs & more',
                  onClick: () => setCreateModal('folder'),
                }] : []),
              ]}
            />
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="ml-1 flex items-center"
          aria-label={open ? 'Collapse space' : 'Expand space'}
        >
          <ChevronVertical open={open} />
        </button>
      </div>

      {/* Expanded children */}
      {open && space && (
        <div className="relative ml-[22px] border-l border-[#E5E5E5]">
          {/* Folders */}
          {space.folders?.map((folder) => (
            <FolderItem key={folder.id} folder={folder} spaceId={spaceId} canAdd={canAddItems && canCreateLists} canDelete={isManager} isManager={isManager} myAccess={myAccess} />
          ))}

          {/* Root lists */}
          {space.lists?.map((list) => (
            <ListItem key={list.id} list={list} isManager={isManager} myAccess={myAccess} />
          ))}

          {/* Create folder/list modal */}
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

      {showSettings && space && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SettingsSlider type="space" id={spaceId} name={space.name} description={space.description} myAccess={myAccess} onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
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
          <p className="px-3 py-2 text-xs text-[#999999]">Loading spaces...</p>
        )}
        {spaces?.length === 0 && !isLoading && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[#999999]">No spaces yet</p>
            {canCreateSpaces && (
              <button
                onClick={handleCreate}
                className="mt-2 text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
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
