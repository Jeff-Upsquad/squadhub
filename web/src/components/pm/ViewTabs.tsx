import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ListViewRow, ListView, ListViewConfig } from '@squadhub/shared';
import ViewSettingsModal from './ViewSettingsModal';

// View-type glyphs — mirror the icons the old fixed List/Board/Whiteboard tabs used.
const TYPE_ICON: Record<ListView, ReactNode> = {
  list: (
    <svg className="vt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  board: (
    <svg className="vt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  ),
  whiteboard: (
    <svg className="vt-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v11a1 1 0 01-1 1h-5l-3 3-3-3H5a1 1 0 01-1-1V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 12.5h5" />
    </svg>
  ),
};

interface ViewTabsProps {
  views: ListViewRow[];
  activeViewId: string | null;
  currentUserId?: string;
  canEdit: boolean;
  listId?: string;
  onSelect: (viewId: string) => void;
  onCreate: (type: ListView) => void;
  onCreateCustom?: (payload: { name: string; view_type: ListView; config: ListViewConfig; is_private?: boolean }) => void;
  onUpdateCustom?: (view: ListViewRow, payload: { name: string; view_type: ListView; config: ListViewConfig; is_private?: boolean }) => void;
  onRename: (view: ListViewRow, name: string) => void;
  onDuplicate: (view: ListViewRow) => void;
  onSetDefault: (view: ListViewRow) => void;
  onTogglePrivate: (view: ListViewRow) => void;
  onDelete: (view: ListViewRow) => void;
}

// A menu anchored below `anchor`, portaled to <body> so the 38px-tall tab strip
// never clips it (see [[home-card-popup-portal]] for the clipping failure mode).
function PortalMenu({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rect = anchor.getBoundingClientRect();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="lv-groupby-menu vt-portal-menu"
      style={{ position: 'fixed', top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 220) }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function ViewTabs({
  views, activeViewId, currentUserId, canEdit, listId,
  onSelect, onCreate, onCreateCustom, onUpdateCustom, onRename, onDuplicate, onSetDefault, onTogglePrivate, onDelete,
}: ViewTabsProps) {
  const [menuFor, setMenuFor] = useState<{ view: ListViewRow; anchor: HTMLElement } | null>(null);
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit';
    initialView: ListViewRow | null;
  }>({
    isOpen: false,
    mode: 'create',
    initialView: null,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const startRename = (view: ListViewRow) => {
    setMenuFor(null);
    setEditingId(view.id);
    setDraftName(view.name);
  };
  const commitRename = (view: ListViewRow) => {
    const name = draftName.trim();
    setEditingId(null);
    if (name && name !== view.name) onRename(view, name);
  };

  return (
    <>
      {views.map((view) => {
        const active = view.id === activeViewId;
        const isEditing = editingId === view.id;
        const hasKeywords = view.config?.keywords && view.config.keywords.length > 0;
        const timeReportExcluded = view.config?.includeInTimeReport === false;
        return (
          <div key={view.id} className="vt-tab-wrap">
            {isEditing ? (
              <input
                className="vt-rename-input"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(view)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(view);
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="lv-tab vt-tab"
                data-active={active}
                onClick={() => onSelect(view.id)}
                onDoubleClick={() => canEdit && startRename(view)}
                title={view.is_private ? `${view.name} (private)` : view.name}
              >
                {TYPE_ICON[view.view_type]}
                <span className="vt-tab-name">{view.name}</span>
                {hasKeywords && (
                  <span
                    className="vt-kw-pill"
                    title={`Keywords: ${view.config.keywords!.join(', ')}`}
                  >
                    {view.config.keywords!.length} kw
                  </span>
                )}
                {timeReportExcluded && (
                  <span
                    className="vt-badge"
                    title="Excluded from time report"
                    style={{ color: '#f59e0b', fontSize: 10, marginLeft: 2 }}
                  >
                    ⏱✕
                  </span>
                )}
                {view.is_default && (
                  <svg className="vt-badge" viewBox="0 0 24 24" fill="currentColor" aria-label="Default view">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14l-5-4.87 6.91-1.01L12 2z" />
                  </svg>
                )}
                {view.is_private && (
                  <svg className="vt-badge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Private view">
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 018 0v4" />
                  </svg>
                )}
              </button>
            )}
            {canEdit && !isEditing && (
              <button
                type="button"
                className="vt-kebab"
                data-active={active}
                aria-label="View options"
                onClick={(e) => { e.stopPropagation(); setMenuFor({ view, anchor: e.currentTarget }); }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
              </button>
            )}
          </div>
        );
      })}

      {canEdit && (
        <button
          type="button"
          className="vt-add"
          aria-label="Add view"
          title="Add a view"
          onClick={() => setModalConfig({ isOpen: true, mode: 'create', initialView: null })}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}

      {menuFor && (
        <PortalMenu anchor={menuFor.anchor} onClose={() => setMenuFor(null)}>
          <button
            type="button"
            className="lv-groupby-item"
            onClick={() => {
              setModalConfig({ isOpen: true, mode: 'edit', initialView: menuFor.view });
              setMenuFor(null);
            }}
          >
            Edit view settings
          </button>
          <button type="button" className="lv-groupby-item" onClick={() => startRename(menuFor.view)}>Rename</button>
          <button type="button" className="lv-groupby-item" onClick={() => { onDuplicate(menuFor.view); setMenuFor(null); }}>Duplicate</button>
          {!menuFor.view.is_default && (
            <button type="button" className="lv-groupby-item" onClick={() => { onSetDefault(menuFor.view); setMenuFor(null); }}>Set as default</button>
          )}
          {(!menuFor.view.is_private || menuFor.view.owner_id === currentUserId) && (
            <button type="button" className="lv-groupby-item" onClick={() => { onTogglePrivate(menuFor.view); setMenuFor(null); }}>
              {menuFor.view.is_private ? 'Make shared' : 'Make private'}
            </button>
          )}
          {views.length > 1 && (
            <button type="button" className="lv-groupby-item vt-danger" onClick={() => { onDelete(menuFor.view); setMenuFor(null); }}>Delete view</button>
          )}
        </PortalMenu>
      )}

      <ViewSettingsModal
        isOpen={modalConfig.isOpen}
        mode={modalConfig.mode}
        initialView={modalConfig.initialView}
        listId={listId || ''}
        onClose={() => setModalConfig({ isOpen: false, mode: 'create', initialView: null })}
        onSave={(payload) => {
          if (modalConfig.mode === 'create') {
            if (onCreateCustom) onCreateCustom(payload);
            else onCreate(payload.view_type);
          } else if (modalConfig.mode === 'edit' && modalConfig.initialView) {
            if (onUpdateCustom) onUpdateCustom(modalConfig.initialView, payload);
          }
          setModalConfig({ isOpen: false, mode: 'create', initialView: null });
        }}
      />
    </>
  );
}
