import { useState } from 'react';
import { useMyClients, useClientFolders } from '../../../hooks/useMyClients';
import { usePMStore } from '../../../stores/pmStore';
import type { MyClientEntry } from '../../../hooks/useMyClients';

export default function ClientsSidebar({ onAddSpace }: { onAddSpace: (clientId: string) => void }) {
  const { data: clients = [], isLoading } = useMyClients();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-divider px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Clients</h3>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {isLoading && (
          <div className="px-4 py-6 text-center text-xs text-foreground-muted">
            Loading…
          </div>
        )}
        {!isLoading && clients.length === 0 && (
          <div className="px-4 py-6 text-center">
            <svg className="mx-auto h-8 w-8 text-foreground-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="mt-2 text-xs text-foreground-muted">No clients yet</p>
            <p className="mt-1 text-[10px] text-foreground-muted/70">An admin will grant you access to clients from the admin panel</p>
          </div>
        )}
        {clients.map((c) => (
          <ClientRow key={c.id} entry={c} onAddSpace={() => onAddSpace(c.client_id)} />
        ))}
      </div>
    </div>
  );
}

function ClientRow({ entry, onAddSpace }: { entry: MyClientEntry; onAddSpace: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const setActiveDesignFolder = usePMStore((s) => s.setActiveDesignFolder);
  const setActiveClient = usePMStore((s) => s.setActiveClient);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  const { data: foldersRes, isLoading } = useClientFolders(expanded ? entry.client_id : null);
  const folders = foldersRes?.folders || [];
  const isAdmin = entry.access_level === 'admin';

  return (
    <div className="mb-1">
      <div className="group flex items-center gap-1 px-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`h-3 w-3 transition ${expanded ? '' : '-rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={() => setActiveClient(entry.client_id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-foreground hover:bg-surface-alt"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-foreground/10 text-[9px] font-semibold uppercase text-foreground">
            {entry.client.business_name.slice(0, 2)}
          </span>
          <span className="truncate">{entry.client.business_name}</span>
        </button>
        {isAdmin && (
          <button
            onClick={onAddSpace}
            title="Add space"
            className="invisible flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition group-hover:visible group-hover:opacity-100 hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>
      {expanded && (
        <div className="pb-1 pl-8 pr-2">
          {isLoading && (
            <div className="py-1 text-[11px] text-foreground-muted">Loading spaces…</div>
          )}
          {!isLoading && folders.length === 0 && (
            <div className="py-1 text-[11px] text-foreground-muted">
              {isAdmin ? 'No spaces yet. Click + to add.' : 'No spaces yet.'}
            </div>
          )}
          {folders.map((f) => {
            const isActive = f.id === activeDesignFolderId;
            const isDesign = (f.client_space_template as any)?.slug === 'design-space';
            return (
              <button
                key={f.id}
                onClick={() => setActiveDesignFolder(f.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] ${
                  isActive ? 'bg-surface-alt text-foreground' : 'text-foreground-dim hover:bg-surface-alt hover:text-foreground'
                }`}
              >
                <span className="shrink-0 text-foreground-muted">
                  {isDesign ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{f.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
