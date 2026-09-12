import { useEffect, useMemo, useRef, useState } from 'react';
import { useLabelPicker, useCreateLabel, useAttachLabel, useDetachLabel, useRequestLabel, useUpdateLabel } from '../../../hooks/useLabels';

const DEFAULT_COLOR = '#6b7280';

export const LABEL_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#d946ef', '#ec4899', '#6b7280',
];

export default function LabelPicker({
  taskId,
  attachedTagIds,
  anchorRect,
  onClose,
}: {
  taskId: string;
  attachedTagIds: string[];
  anchorRect: DOMRect | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useLabelPicker(taskId, true);
  const createLabel = useCreateLabel(taskId);
  const attachLabel = useAttachLabel(taskId);
  const detachLabel = useDetachLabel(taskId);
  const requestLabel = useRequestLabel(taskId);
  const updateLabel = useUpdateLabel(taskId);

  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState<string | null>(null);
  const [newColor, setNewColor] = useState(LABEL_COLORS[7]);
  const [recolorId, setRecolorId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const attached = useMemo(() => new Set(attachedTagIds), [attachedTagIds]);
  const q = query.trim().toLowerCase();

  // Filter each group's labels by the query; drop empty groups while searching.
  const groups = useMemo(() => {
    const all = data?.groups || [];
    if (!q) return all.filter((g) => g.labels.length > 0);
    return all
      .map((g) => ({ ...g, labels: g.labels.filter((l) => l.name.toLowerCase().includes(q)) }))
      .filter((g) => g.labels.length > 0);
  }, [data, q]);

  // Does any visible label exactly match the typed name?
  const exactMatch = useMemo(() => {
    if (!q) return true;
    return (data?.groups || []).some((g) => g.labels.some((l) => l.name.toLowerCase() === q));
  }, [data, q]);

  const canCreate = !!data?.can_create;
  const showCreateRow = q.length > 0 && !exactMatch && canCreate;
  const showRequestRow = q.length > 0 && !exactMatch && !canCreate;

  const toggle = (tagId: string) => {
    if (attached.has(tagId)) detachLabel.mutate(tagId);
    else attachLabel.mutate(tagId);
  };

  const handleCreate = async () => {
    const name = query.trim();
    if (!name) return;
    const label = await createLabel.mutateAsync({ name, color: newColor });
    if (label?.id) attachLabel.mutate(label.id);
    setQuery('');
  };

  const handleRequest = async () => {
    const name = query.trim();
    if (!name) return;
    await requestLabel.mutateAsync({ name });
    setRequested(name);
    setQuery('');
  };

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const height = 360;
    const spaceBelow = vh - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const placeAbove = spaceBelow < height && spaceAbove > spaceBelow;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    const top = placeAbove ? Math.max(8, anchorRect.top - height - 4) : anchorRect.bottom + 4;
    return { top, left, width };
  }, [anchorRect]);

  return (
    <div ref={panelRef} className="ap-panel" style={style} role="dialog" aria-label="Labels">
      <div className="ap-search">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search or add a label…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setRequested(null); }}
          className="ap-input"
        />
      </div>

      <div className="ap-list">
        {isLoading && <div className="ap-empty">Loading…</div>}

        {!isLoading && groups.length === 0 && !showCreateRow && !showRequestRow && (
          <div className="ap-empty">{q ? 'No matching labels' : 'No labels available'}</div>
        )}

        {!isLoading && groups.map((g) => (
          <div key={g.group.id}>
            <div
              style={{
                padding: '6px 10px 2px',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--sh-ink-3)',
              }}
            >
              {g.group.name}
            </div>
            {g.labels.map((l) => {
              const sel = attached.has(l.id);
              const recoloring = recolorId === l.id;
              return (
                <div key={l.id}>
                  <div className="ap-row" data-selected={sel} style={{ cursor: 'default' }}>
                    <button
                      type="button"
                      onClick={() => toggle(l.id)}
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: l.color || DEFAULT_COLOR, width: 10, height: 10, borderRadius: 9999, border: 'none', padding: 0, cursor: 'pointer' }}
                      aria-hidden
                      tabIndex={-1}
                    />
                    <button
                      type="button"
                      className="ap-label"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', flex: 1 }}
                      onClick={() => toggle(l.id)}
                    >
                      <span className="ap-name">{l.name}</span>
                    </button>
                    {canCreate && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRecolorId(recoloring ? null : l.id); }}
                        title="Change color"
                        aria-label={`Change color of ${l.name}`}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                          fontSize: 11, color: 'var(--sh-ink-4)', lineHeight: 1,
                        }}
                      >
                        🎨
                      </button>
                    )}
                    {sel && (
                      <svg className="ap-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  {recoloring && (
                    <div style={{ display: 'flex', gap: 6, padding: '4px 10px 8px 30px', flexWrap: 'wrap' }}>
                      {LABEL_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            updateLabel.mutate({ id: l.id, color: c }, { onSuccess: () => setRecolorId(null) });
                          }}
                          title={c}
                          aria-label={`Set ${l.name} to ${c}`}
                          style={{
                            width: 18, height: 18, borderRadius: 9999, background: c, cursor: 'pointer',
                            border: (l.color || DEFAULT_COLOR).toLowerCase() === c.toLowerCase()
                              ? '2px solid var(--sh-ink)' : '2px solid transparent',
                            outline: 'none', padding: 0,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {showCreateRow && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: 6, padding: '6px 10px', flexWrap: 'wrap' }} aria-label="Pick a color">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  title={c}
                  aria-label={`Use color ${c}`}
                  style={{
                    width: 18, height: 18, borderRadius: 9999, background: c, cursor: 'pointer',
                    border: newColor.toLowerCase() === c.toLowerCase()
                      ? '2px solid var(--sh-ink)' : '2px solid transparent',
                    outline: 'none', padding: 0,
                  }}
                />
              ))}
            </div>
            <button type="button" className="ap-row" onClick={handleCreate} disabled={createLabel.isPending}>
              <span style={{ background: newColor, width: 10, height: 10, borderRadius: 9999, display: 'inline-block' }} aria-hidden />
              <span className="ap-label"><span className="ap-name">Create “{query.trim()}”</span></span>
            </button>
          </div>
        )}

        {showRequestRow && (
          <button type="button" className="ap-row" onClick={handleRequest} disabled={requestLabel.isPending}>
            <span style={{ fontSize: 14, width: 14, textAlign: 'center' }} aria-hidden>✉</span>
            <span className="ap-label"><span className="ap-name">Request “{query.trim()}” from an admin</span></span>
          </button>
        )}
      </div>

      {requested && (
        <div className="ap-clear" style={{ cursor: 'default', color: 'var(--sh-ink-3)' }}>
          Requested “{requested}” ✓ — an admin will review it.
        </div>
      )}
    </div>
  );
}
