import { useState } from 'react';
import { useSpaces, useSpace, useCreateFolder, useCreateList } from '../../../hooks/useSpaces';
import { useHasPermission } from '../../../hooks/usePermissions';
import { usePMStore } from '../../../stores/pmStore';
import CreateSpaceModal from './CreateSpaceModal';
import ManageMembersModal from './ManageMembersModal';
import type { Folder, List, AccessLevel } from '@squadhub/shared';

// Access level check helper
function canAtLeast(userLevel: AccessLevel | undefined, required: AccessLevel): boolean {
  const levels: AccessLevel[] = ['viewer', 'commenter', 'member', 'manager'];
  if (!userLevel) return false;
  return levels.indexOf(userLevel) >= levels.indexOf(required);
}

// ---- Chevron icon ----
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-[#999999] transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ---- List item ----
function ListItem({ list, depth = 0 }: { list: List; depth?: number }) {
  const { activeListId, setActiveList } = usePMStore();
  const isActive = activeListId === list.id;

  return (
    <button
      onClick={() => setActiveList(list.id)}
      className={`flex w-full items-center gap-2 rounded-md py-1 text-left text-[13px] transition ${
        isActive
          ? 'bg-[#F8FAFC] text-[#0F172B]'
          : 'text-[#666666] hover:bg-[#F8FAFC]'
      }`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
      <span className="truncate">{list.name}</span>
    </button>
  );
}

// ---- Folder item ----
function FolderItem({ folder, spaceId, canAdd }: { folder: Folder; spaceId: string; canAdd: boolean }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const createList = useCreateList(spaceId);

  const handleAdd = () => {
    if (!newName.trim()) { setAdding(false); return; }
    createList.mutate({ name: newName.trim(), folder_id: folder.id }, {
      onSuccess: () => { setNewName(''); setAdding(false); },
    });
  };

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1.5 rounded-md px-3 py-1 text-left text-[13px] text-[#666666] hover:bg-[#F8FAFC]"
        >
          <ChevronIcon open={open} />
          <svg className="h-3.5 w-3.5 shrink-0 text-yellow-500/70" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
          </svg>
          <span className="truncate">{folder.name}</span>
        </button>
        {canAdd && (
          <button
            onClick={() => setAdding(true)}
            className="mr-2 hidden text-[#999999] hover:text-[#0F172B] group-hover:block"
            title="Add list"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div className="ml-1">
          {folder.lists?.map((list) => (
            <ListItem key={list.id} list={list} depth={2} />
          ))}
          {adding && (
            <div className="px-3 py-1" style={{ paddingLeft: '44px' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                onBlur={handleAdd}
                placeholder="List name..."
                className="w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Space item ----
function SpaceItem({ spaceId }: { spaceId: string }) {
  const { activeSpaceId, setActiveSpace, setActiveList } = usePMStore();
  const isActive = activeSpaceId === spaceId;
  const [open, setOpen] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const canCreateFolders = useHasPermission('can_create_folders');
  const canCreateLists = useHasPermission('can_create_lists');

  const { data: space } = useSpace(isActive || open ? spaceId : null);
  const createFolder = useCreateFolder(spaceId);
  const createList = useCreateList(spaceId);

  const myAccess = space?.my_access_level;
  const canAddItems = canAtLeast(myAccess, 'member');
  const isManager = canAtLeast(myAccess, 'manager');

  const handleSelect = () => {
    setActiveSpace(spaceId);
    setOpen(true);
    // Auto-select first list
    if (space) {
      const firstList = space.folders?.[0]?.lists?.[0] || space.lists?.[0];
      if (firstList) setActiveList(firstList.id);
    }
  };

  const handleAddFolder = () => {
    if (!newName.trim()) { setAddingFolder(false); return; }
    createFolder.mutate({ name: newName.trim() }, {
      onSuccess: () => { setNewName(''); setAddingFolder(false); },
    });
  };

  const handleAddList = () => {
    if (!newName.trim()) { setAddingList(false); return; }
    createList.mutate({ name: newName.trim() }, {
      onSuccess: () => { setNewName(''); setAddingList(false); },
    });
  };

  return (
    <div className="mb-1">
      <div className="group flex items-center">
        <button
          onClick={() => { setOpen(!open); if (!open) handleSelect(); }}
          className={`flex flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm font-medium transition ${
            isActive && open
              ? 'text-[#0F172B]'
              : 'text-[#666666] hover:bg-[#F8FAFC]'
          }`}
        >
          <ChevronIcon open={open} />
          <span
            className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-white"
            style={{ backgroundColor: space?.color || '#7c3aed' }}
          >
            {space?.name?.[0]?.toUpperCase() || 'S'}
          </span>
          <span className="truncate">{space?.name || 'Loading...'}</span>
        </button>
        <div className="mr-2 hidden gap-0.5 group-hover:flex">
          {canAddItems && canCreateFolders && (
            <button
              onClick={() => setAddingFolder(true)}
              className="rounded p-0.5 text-[#999999] hover:text-[#0F172B]"
              title="Add folder"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>
          )}
          {canAddItems && canCreateLists && (
            <button
              onClick={() => setAddingList(true)}
              className="rounded p-0.5 text-[#999999] hover:text-[#0F172B]"
              title="Add list"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
          {isManager && (
            <button
              onClick={() => setShowMembers(true)}
              className="rounded p-0.5 text-[#999999] hover:text-[#0F172B]"
              title="Manage members"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {open && space && (
        <div className="ml-1">
          {/* Folders */}
          {space.folders?.map((folder) => (
            <FolderItem key={folder.id} folder={folder} spaceId={spaceId} canAdd={canAddItems && canCreateLists} />
          ))}

          {/* Root lists (not in any folder) */}
          {space.lists?.map((list) => (
            <ListItem key={list.id} list={list} depth={1} />
          ))}

          {/* Inline add folder */}
          {addingFolder && (
            <div className="px-3 py-1" style={{ paddingLeft: '28px' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddFolder(); if (e.key === 'Escape') setAddingFolder(false); }}
                onBlur={handleAddFolder}
                placeholder="Folder name..."
                className="w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            </div>
          )}

          {/* Inline add list */}
          {addingList && (
            <div className="px-3 py-1" style={{ paddingLeft: '28px' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddList(); if (e.key === 'Escape') setAddingList(false); }}
                onBlur={handleAddList}
                placeholder="List name..."
                className="w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            </div>
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
    </div>
  );
}

// ---- Main SpaceTree ----
export default function SpaceTree({ workspaceId }: { workspaceId: string }) {
  const { data: spaces, isLoading } = useSpaces(workspaceId);
  const [showCreate, setShowCreate] = useState(false);
  const canCreateSpaces = useHasPermission('can_create_spaces');

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">Spaces</h2>
        {canCreateSpaces && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-lg text-[#666666] hover:text-[#0F172B]"
            title="Create space"
          >
            +
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {isLoading && (
          <p className="px-3 py-2 text-xs text-[#999999]">Loading spaces...</p>
        )}
        {spaces?.length === 0 && !isLoading && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[#999999]">No spaces yet</p>
            {canCreateSpaces && (
              <button
                onClick={() => setShowCreate(true)}
                className="mt-2 text-xs font-medium text-[#0F172B] hover:text-[#2962FF]"
              >
                Create your first space
              </button>
            )}
          </div>
        )}
        {spaces?.map((space) => (
          <SpaceItem key={space.id} spaceId={space.id} />
        ))}
      </div>

      {showCreate && (
        <CreateSpaceModal
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
