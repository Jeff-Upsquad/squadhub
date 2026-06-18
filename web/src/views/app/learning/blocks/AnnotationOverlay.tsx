'use client';
import { useState } from 'react';
import type { Annotation, AnnotationColor, ImageAnnotationData } from '@squadhub/shared';

// Read-only renderer for image markings (see ImageAnnotationData). Draws the
// original <img> with two layers on top:
//   - an <svg> for geometry (rects, arrows) whose viewBox matches the image's
//     natural aspect ratio so shapes scale uniformly (no skewed arrowheads),
//   - an HTML layer for text callouts and numbered badges, with fixed font
//     sizes so text stays legible at any rendered width (incl. mobile).
// All annotation coordinates are percentages (0–100) of the natural image size.

export const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  red: '#e5484d',
  amber: '#f5a623',
  green: '#30a46c',
  blue: '#3b82f6',
  ink: '#1f2937',
};

export default function AnnotationOverlay({
  src,
  alt,
  data,
  className,
}: {
  src: string;
  alt?: string;
  data: ImageAnnotationData;
  className?: string;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    data.naturalWidth && data.naturalHeight ? { w: data.naturalWidth, h: data.naturalHeight } : null
  );
  const W = dims?.w || 1000;
  const H = dims?.h || 1000;
  // Stroke/scale reference in natural-image pixels (a few px on a ~1000px img).
  const unit = Math.max(W, H) / 100;
  const anns = data.annotations || [];
  const colors = Object.keys(ANNOTATION_COLORS) as AnnotationColor[];

  return (
    <div className={`relative w-full ${className || ''}`}>
      <img
        src={src}
        alt={alt || ''}
        className="block w-full rounded-lg border border-[var(--sh-hair)]"
        onLoad={(e) => {
          if (!dims) {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setDims({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
      />

      {/* Geometry layer (rects + arrows). preserveAspectRatio="none" is safe
          here because the overlay exactly covers the image, so the element's
          aspect ratio equals the viewBox aspect ratio → uniform scaling. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          {colors.map((c) => (
            <marker
              key={c}
              id={`sh-arrow-${c}`}
              markerWidth="6"
              markerHeight="6"
              refX="4.5"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill={ANNOTATION_COLORS[c]} />
            </marker>
          ))}
        </defs>
        {anns.map((a) => renderSvgShape(a, W, H, unit))}
      </svg>

      {/* Text + badge layer (HTML, fixed sizing) */}
      <div className="pointer-events-none absolute inset-0">
        {anns.map((a) => renderHtmlShape(a))}
      </div>
    </div>
  );
}

function renderSvgShape(a: Annotation, W: number, H: number, unit: number) {
  const stroke = ANNOTATION_COLORS[a.color] || ANNOTATION_COLORS.red;
  if (a.type === 'rect') {
    return (
      <rect
        key={a.id}
        x={(a.x / 100) * W}
        y={(a.y / 100) * H}
        width={(a.w / 100) * W}
        height={(a.h / 100) * H}
        fill="none"
        stroke={stroke}
        strokeWidth={unit * 0.5}
        rx={unit * 0.4}
      />
    );
  }
  if (a.type === 'arrow') {
    return (
      <line
        key={a.id}
        x1={(a.x1 / 100) * W}
        y1={(a.y1 / 100) * H}
        x2={(a.x2 / 100) * W}
        y2={(a.y2 / 100) * H}
        stroke={stroke}
        strokeWidth={unit * 0.55}
        strokeLinecap="round"
        markerEnd={`url(#sh-arrow-${a.color})`}
      />
    );
  }
  return null;
}

function renderHtmlShape(a: Annotation) {
  const color = ANNOTATION_COLORS[a.color] || ANNOTATION_COLORS.red;
  if (a.type === 'text') {
    return (
      <div
        key={a.id}
        className="absolute rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-snug text-white shadow-sm"
        style={{
          left: `${a.x}%`,
          top: `${a.y}%`,
          maxWidth: `${a.wPct ?? 30}%`,
          backgroundColor: color,
        }}
      >
        {a.text}
      </div>
    );
  }
  if (a.type === 'badge') {
    return (
      <div
        key={a.id}
        className="absolute grid h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[12px] font-bold text-white shadow"
        style={{ left: `${a.x}%`, top: `${a.y}%`, backgroundColor: color }}
      >
        {a.label}
      </div>
    );
  }
  return null;
}
