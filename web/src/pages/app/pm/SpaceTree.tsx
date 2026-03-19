import { useState } from 'react';
import { useSpaces, useSpace, useCreateFolder, useCreateList } from '../../../hooks/useSpaces';
import { usePMStore } from '../../../stores/pmStore';
import CreateSpaceModal from './CreateSpaceModal';
import type { Folder, List } from '@squadhub/shared';

// ---- Chevron icon ----
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
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
          ? 'bg-[var(--color-sidebar-active)] text-white'
          : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]'
      }`}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
    >
      <svg className="h-3.5 w-3.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
      <span className="truncate">{list.name}</span>
    </button>
  );
}

// ---- Folder item ----
function FolderItem({ folder, spaceId }: { folder: Folder; spaceId: string }) {
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
          className="flex flex-1 items-center gap-1.5 rounded-md px-3 py-1 text-left text-[13px] text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]"
        >
          <ChevronIcon open={open} />
          <svg className="h-3.5 w-3.5 shrink-0 text-yellow-500/70" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
          </svg>
          <span className="truncate">{folder.name}</span>
        </button>
        <button
          onClick={() => setAdding(true)}
          className="mr-2 hidden text-gray-500 hover:text-white group-hover:block"
          title="Add list"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
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
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white placeholder-gray-500 outline-none focus:border-brand-500"
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

  const { data: space } = useSpace(isActive || open ? spaceId : null);
  const createFolder = useCreateFolder(spaceId);
  const createList = useCreateList(spaceId);

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
              ? 'text-white'
              : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]'
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
          <button
            onClick={() => setAddingFolder(true)}
            className="rounded p-0.5 text-gray-500 hover:text-white"
            title="Add folder"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
          <button
            onClick={() => setAddingList(true)}
            className="rounded p-0.5 text-gray-500 hover:text-white"
            title="Add list"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {open && space && (
        <div className="ml-1">
          {/* Folders */}
          {space.folders?.map((folder) => (
            <FolderItem key={folder.id} folder={folder} spaceId={spaceId} />
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
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white placeholder-gray-500 outline-none focus:border-brand-500"
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
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white placeholder-gray-500 outline-none focus:border-brand-500"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main SpaceTree ----
export default function SpaceTree({ workspaceId }: { workspaceId: string }) {
  const { data: spaces, isLoading } = useSpaces(workspaceId);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--color-sidebar-text-bright)]">Spaces</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-lg text-gray-400 hover:text-white"
          title="Create space"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {isLoading && (
          <p className="px-3 py-2 text-xs text-gray-500">Loading spaces...</p>
        )}
        {spaces?.length === 0 && !isLoading && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-gray-500">No spaces yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-2 text-xs font-medium text-brand-400 hover:text-brand-300"
            >
              Create your first space
            </button>
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
