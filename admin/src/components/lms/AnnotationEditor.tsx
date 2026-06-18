'use client';
import { useEffect, useRef, useState } from 'react';
import type { Annotation, AnnotationColor, ImageAnnotationData } from '@squadhub/shared';

// Authoring tool for image markings. Draws on top of an uploaded screenshot and
// persists the result to the block's metadata.annotations (percentage coords).
// MVP toolset: rectangle highlight, arrow, text callout, numbered badge, plus
// select/move/recolor/delete. No resize handles yet (delete & redraw instead).

const COLORS: Record<AnnotationColor, string> = {
  red: '#e5484d',
  amber: '#f5a623',
  green: '#30a46c',
  blue: '#3b82f6',
  ink: '#1f2937',
};

type Tool = 'select' | 'rect' | 'arrow' | 'text' | 'badge';

const TOOLS: { key: Tool; label: string; icon: string }[] = [
  { key: 'select', label: 'Select', icon: '➚' },
  { key: 'rect', label: 'Box', icon: '▭' },
  { key: 'arrow', label: 'Arrow', icon: '↗' },
  { key: 'text', label: 'Text', icon: 'T' },
  { key: 'badge', label: 'Step', icon: '①' },
];

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `a_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export default function AnnotationEditor({
  src,
  initial,
  onChange,
}: {
  src: string;
  initial?: ImageAnnotationData | null;
  onChange: (data: ImageAnnotationData) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [anns, setAnns] = useState<Annotation[]>(initial?.annotations ?? []);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState<AnnotationColor>('red');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    initial?.naturalWidth && initial?.naturalHeight ? { w: initial.naturalWidth, h: initial.naturalHeight } : null
  );
  const [draft, setDraft] = useState<Annotation | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; orig: Annotation } | null>(null);
  const drawRef = useRef<{ startX: number; startY: number } | null>(null);

  // Debounced persistence — collapse rapid edits into one save.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = (nextAnns: Annotation[], nextDims = dims) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onChange({
        version: 1,
        naturalWidth: nextDims?.w,
        naturalHeight: nextDims?.h,
        annotations: nextAnns,
      });
    }, 400);
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const commit = (next: Annotation[]) => {
    setAnns(next);
    persist(next);
  };

  const W = dims?.w || 1000;
  const H = dims?.h || 1000;
  const unit = Math.max(W, H) / 100;

  function pct(e: React.PointerEvent) {
    const el = wrapRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100),
      rectW: r.width,
    };
  }

  // Topmost annotation under a point (for select/move). Tolerances in percent.
  function hitTest(x: number, y: number, rectW: number): string | null {
    const badgePct = (11 / rectW) * 100; // ~half of the 22px badge, in %
    for (let i = anns.length - 1; i >= 0; i--) {
      const a = anns[i];
      if (a.type === 'rect') {
        if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a.id;
      } else if (a.type === 'badge') {
        if (Math.abs(x - a.x) <= badgePct + 1 && Math.abs(y - a.y) <= badgePct + 1) return a.id;
      } else if (a.type === 'text') {
        if (x >= a.x - 1 && x <= a.x + (a.wPct ?? 30) && y >= a.y - 1 && y <= a.y + 6) return a.id;
      } else if (a.type === 'arrow') {
        if (distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= 2.5) return a.id;
      }
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!dims) return;
    const p = pct(e);
    wrapRef.current?.setPointerCapture(e.pointerId);

    if (tool === 'select') {
      const id = hitTest(p.x, p.y, p.rectW);
      setSelectedId(id);
      if (id) {
        const orig = anns.find((a) => a.id === id)!;
        dragRef.current = { id, startX: p.x, startY: p.y, orig };
      }
      return;
    }
    if (tool === 'rect' || tool === 'arrow') {
      drawRef.current = { startX: p.x, startY: p.y };
      setDraft(
        tool === 'rect'
          ? { id: 'draft', type: 'rect', color, x: p.x, y: p.y, w: 0, h: 0 }
          : { id: 'draft', type: 'arrow', color, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
      );
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Callout text');
      if (text && text.trim()) {
        const next = [...anns, { id: newId(), type: 'text', color, x: p.x, y: p.y, text: text.trim(), wPct: 30 } as Annotation];
        commit(next);
        setSelectedId(next[next.length - 1].id);
      }
      return;
    }
    if (tool === 'badge') {
      const n = anns.filter((a) => a.type === 'badge').length + 1;
      const next = [...anns, { id: newId(), type: 'badge', color, x: p.x, y: p.y, label: String(n) } as Annotation];
      commit(next);
      setSelectedId(next[next.length - 1].id);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dims) return;
    const p = pct(e);

    if (dragRef.current && tool === 'select') {
      const { id, startX, startY, orig } = dragRef.current;
      const dx = p.x - startX;
      const dy = p.y - startY;
      setAnns((prev) => prev.map((a) => (a.id === id ? moveAnnotation(orig, dx, dy) : a)));
      return;
    }
    if (drawRef.current && draft) {
      const { startX, startY } = drawRef.current;
      if (draft.type === 'rect') {
        setDraft({ ...draft, x: Math.min(startX, p.x), y: Math.min(startY, p.y), w: Math.abs(p.x - startX), h: Math.abs(p.y - startY) });
      } else if (draft.type === 'arrow') {
        setDraft({ ...draft, x2: p.x, y2: p.y });
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    wrapRef.current?.releasePointerCapture(e.pointerId);
    if (dragRef.current) {
      dragRef.current = null;
      persist(anns); // anns already updated during move
      return;
    }
    if (drawRef.current && draft) {
      drawRef.current = null;
      const committed = { ...draft, id: newId() } as Annotation;
      // Ignore zero-size accidental clicks.
      const tooSmall =
        (committed.type === 'rect' && committed.w < 1 && committed.h < 1) ||
        (committed.type === 'arrow' && Math.abs(committed.x1 - committed.x2) < 1 && Math.abs(committed.y1 - committed.y2) < 1);
      setDraft(null);
      if (!tooSmall) {
        const next = [...anns, committed];
        commit(next);
        setSelectedId(committed.id);
      }
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    const next = anns.filter((a) => a.id !== selectedId);
    setSelectedId(null);
    commit(next);
  }

  function recolorSelected(c: AnnotationColor) {
    setColor(c);
    if (selectedId) {
      const next = anns.map((a) => (a.id === selectedId ? { ...a, color: c } : a));
      commit(next);
    }
  }

  // Keyboard delete for the selected shape.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedId) {
        const tag = (ev.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        ev.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, anns]);

  const render = draft ? [...anns, draft] : anns;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-divider bg-surface-alt px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setTool(t.key); if (t.key !== 'select') setSelectedId(null); }}
              title={t.label}
              className={`grid h-7 min-w-7 place-items-center rounded px-1.5 text-[13px] ${
                tool === t.key ? 'bg-ink text-white' : 'text-foreground-muted hover:bg-surface'
              }`}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-divider" />
        <div className="flex items-center gap-1">
          {(Object.keys(COLORS) as AnnotationColor[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => recolorSelected(c)}
              title={c}
              className={`h-5 w-5 rounded-full border-2 ${color === c ? 'border-foreground' : 'border-transparent'}`}
              style={{ backgroundColor: COLORS[c] }}
            />
          ))}
        </div>
        <span className="h-4 w-px bg-divider" />
        <button
          type="button"
          onClick={deleteSelected}
          disabled={!selectedId}
          className="rounded px-2 py-1 text-[12px] text-red-600 enabled:hover:bg-surface disabled:opacity-40"
        >
          Delete
        </button>
        <span className="ml-auto text-[11px] text-foreground-dim">
          {tool === 'select' ? 'Click a marking to move or recolor it' : `Draw a ${tool}`}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative w-full select-none overflow-hidden rounded-md border border-divider"
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="block w-full"
          onLoad={(e) => {
            if (!dims) {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                const d = { w: img.naturalWidth, h: img.naturalHeight };
                setDims(d);
                persist(anns, d);
              }
            }
          }}
        />

        {/* Geometry layer */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            {(Object.keys(COLORS) as AnnotationColor[]).map((c) => (
              <marker key={c} id={`ed-arrow-${c}`} markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L6,3 L0,6 Z" fill={COLORS[c]} />
              </marker>
            ))}
          </defs>
          {render.map((a) => {
            const sel = a.id === selectedId;
            const stroke = COLORS[a.color];
            if (a.type === 'rect') {
              return (
                <g key={a.id}>
                  <rect x={(a.x / 100) * W} y={(a.y / 100) * H} width={(a.w / 100) * W} height={(a.h / 100) * H} fill="none" stroke={stroke} strokeWidth={unit * 0.5} rx={unit * 0.4} />
                  {sel && <rect x={(a.x / 100) * W - unit} y={(a.y / 100) * H - unit} width={(a.w / 100) * W + unit * 2} height={(a.h / 100) * H + unit * 2} fill="none" stroke="#3b82f6" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit}`} />}
                </g>
              );
            }
            if (a.type === 'arrow') {
              return (
                <line key={a.id} x1={(a.x1 / 100) * W} y1={(a.y1 / 100) * H} x2={(a.x2 / 100) * W} y2={(a.y2 / 100) * H} stroke={stroke} strokeWidth={unit * (sel ? 0.7 : 0.55)} strokeLinecap="round" markerEnd={`url(#ed-arrow-${a.color})`} />
              );
            }
            return null;
          })}
        </svg>

        {/* Text + badge layer */}
        <div className="pointer-events-none absolute inset-0">
          {render.map((a) => {
            const sel = a.id === selectedId;
            if (a.type === 'text') {
              return (
                <div key={a.id} className={`absolute rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-snug text-white shadow-sm ${sel ? 'ring-2 ring-blue-500' : ''}`}
                  style={{ left: `${a.x}%`, top: `${a.y}%`, maxWidth: `${a.wPct ?? 30}%`, backgroundColor: COLORS[a.color] }}>
                  {a.text}
                </div>
              );
            }
            if (a.type === 'badge') {
              return (
                <div key={a.id} className={`absolute grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[12px] font-bold text-white shadow ${sel ? 'ring-2 ring-blue-500' : ''}`}
                  style={{ left: `${a.x}%`, top: `${a.y}%`, backgroundColor: COLORS[a.color] }}>
                  {a.label}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.type === 'rect') return { ...a, x: clamp(a.x + dx), y: clamp(a.y + dy) };
  if (a.type === 'arrow') return { ...a, x1: clamp(a.x1 + dx), y1: clamp(a.y1 + dy), x2: clamp(a.x2 + dx), y2: clamp(a.y2 + dy) };
  return { ...a, x: clamp(a.x + dx), y: clamp(a.y + dy) };
}

// Distance from point (px,py) to segment (ax,ay)-(bx,by), all in percent units.
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
