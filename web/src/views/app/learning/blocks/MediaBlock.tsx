'use client';
import type { ImageAnnotationData, LmsContentBlock } from '@squadhub/shared';
import AnnotationOverlay from './AnnotationOverlay';

// Pull annotation overlay data out of the block's freeform metadata, tolerating
// older/plain images (no annotations) and unknown future schema versions.
function getAnnotations(block: LmsContentBlock): ImageAnnotationData | null {
  const data = (block.metadata as { annotations?: ImageAnnotationData } | undefined)?.annotations;
  if (!data || data.version !== 1 || !Array.isArray(data.annotations) || data.annotations.length === 0) {
    return null;
  }
  return data;
}

export function ImageBlock({ block }: { block: LmsContentBlock }) {
  if (!block.file_url) return <PlaceholderBlock>Missing image</PlaceholderBlock>;
  const alt = (block.metadata as { alt?: string } | undefined)?.alt || block.caption || '';
  const annotations = getAnnotations(block);
  return (
    <figure className="my-6 overflow-hidden rounded-xl border border-[var(--sh-hair)] bg-[var(--sidebar)] p-2 shadow-sm">
      {annotations ? (
        <AnnotationOverlay src={block.file_url} alt={alt} data={annotations} />
      ) : (
        <img src={block.file_url} alt={alt} className="mx-auto block h-auto max-h-[720px] max-w-full rounded-lg object-contain" />
      )}
      {block.caption && <figcaption className="px-3 pb-1 pt-3 text-center text-[12px] leading-relaxed text-[var(--sh-ink-3)]">{block.caption}</figcaption>}
    </figure>
  );
}

export function VideoUploadBlock({ block }: { block: LmsContentBlock }) {
  if (!block.file_url) return <PlaceholderBlock>Missing video</PlaceholderBlock>;
  return (
    <figure className="my-2">
      <video src={block.file_url} controls className="w-full rounded-lg border border-[var(--sh-hair)] bg-black" />
      {block.caption && <figcaption className="mt-2 text-center text-[13px] text-[var(--sh-ink-3)]">{block.caption}</figcaption>}
    </figure>
  );
}

export function AudioBlock({ block }: { block: LmsContentBlock }) {
  if (!block.file_url) return <PlaceholderBlock>Missing audio</PlaceholderBlock>;
  return (
    <div className="my-2">
      <audio src={block.file_url} controls className="w-full" />
      {block.caption && <p className="mt-1 text-[13px] text-[var(--sh-ink-3)]">{block.caption}</p>}
    </div>
  );
}

export function PdfBlock({ block }: { block: LmsContentBlock }) {
  if (!block.file_url) return <PlaceholderBlock>Missing PDF</PlaceholderBlock>;
  return (
    <div className="my-2">
      <div className="flex items-center justify-between gap-2 rounded-t-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2">
        <span className="truncate text-sm text-[var(--sh-ink)]">{block.file_name || 'Document.pdf'}</span>
        <a
          href={block.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-[var(--sh-hair)] px-2 py-1 text-[12px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
        >
          Download
        </a>
      </div>
      <iframe
        src={block.file_url}
        className="h-[640px] w-full rounded-b-lg border border-t-0 border-[var(--sh-hair)] bg-white"
        title={block.file_name || 'PDF'}
      />
      {block.caption && <p className="mt-2 text-center text-[13px] text-[var(--sh-ink-3)]">{block.caption}</p>}
    </div>
  );
}

function PlaceholderBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 rounded-lg border border-dashed border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--sh-ink-3)]">
      {children}
    </div>
  );
}
