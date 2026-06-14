'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsContentBlock, LmsBlockType } from '@squadhub/shared';
import TiptapEditor from './TiptapEditor';
import MediaUploader from './MediaUploader';
import VideoEmbedInput from './VideoEmbedInput';
import QuizEditor from './QuizEditor';

interface Props {
  itemId: string;
  lessonId: string;
  blocks: LmsContentBlock[];
}

const BLOCK_LABELS: Record<LmsBlockType, string> = {
  text: 'Text',
  image: 'Image',
  video_upload: 'Video (upload)',
  video_embed: 'Video (embed)',
  audio: 'Audio',
  pdf: 'PDF',
  quiz: 'Quiz',
};

const BLOCK_ICONS: Record<LmsBlockType, string> = {
  text: '📝',
  image: '🖼️',
  video_upload: '🎬',
  video_embed: '▶️',
  audio: '🎧',
  pdf: '📄',
  quiz: '❓',
};

export default function BlockList({ itemId, lessonId, blocks }: Props) {
  const qc = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);

  const addBlock = useMutation({
    mutationFn: (type: LmsBlockType) => api.post(`/admin/lms/lessons/${lessonId}/blocks`, { type }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-item', itemId] });
      setShowPicker(false);
    },
  });

  const updateBlock = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/admin/lms/blocks/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const deleteBlock = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  const reorder = useMutation({
    mutationFn: (items: { id: string; position: number }[]) =>
      api.put(`/admin/lms/lessons/${lessonId}/blocks/reorder`, { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-item', itemId] }),
  });

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const reordered = [...blocks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    reorder.mutate(reordered.map((b, i) => ({ id: b.id, position: i })));
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <div key={block.id} className="rounded-lg border border-divider bg-surface">
          <div className="flex items-center justify-between border-b border-divider px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[14px]">{BLOCK_ICONS[block.type]}</span>
              <span className="text-[12px] font-medium text-foreground-muted">{BLOCK_LABELS[block.type]}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => moveBlock(i, -1)} disabled={i === 0} className="rounded p-1 text-foreground-dim hover:bg-surface-alt hover:text-foreground disabled:opacity-30" title="Move up">↑</button>
              <button onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1} className="rounded p-1 text-foreground-dim hover:bg-surface-alt hover:text-foreground disabled:opacity-30" title="Move down">↓</button>
              <button onClick={() => { if (confirm('Delete this block?')) deleteBlock.mutate(block.id); }} className="rounded p-1 text-foreground-dim hover:bg-red-50 hover:text-red-600" title="Delete">×</button>
            </div>
          </div>
          <div className="p-3">
            <BlockEditor
              block={block}
              itemId={itemId}
              lessonId={lessonId}
              onPatch={(patch) => updateBlock.mutate({ id: block.id, ...patch })}
            />
          </div>
        </div>
      ))}

      {showPicker ? (
        <div className="rounded-lg border border-dashed border-divider-strong bg-surface-alt p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Pick a block type</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(Object.keys(BLOCK_LABELS) as LmsBlockType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addBlock.mutate(t)}
                className="flex items-center gap-2 rounded-md border border-divider bg-surface px-3 py-2 text-left text-sm text-foreground hover:border-ink"
              >
                <span>{BLOCK_ICONS[t]}</span>
                <span>{BLOCK_LABELS[t]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowPicker(false)} className="mt-2 text-[12px] text-foreground-muted hover:text-foreground">Cancel</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="w-full rounded-md border border-dashed border-divider-strong bg-surface py-2 text-sm text-foreground-muted hover:border-ink hover:text-foreground"
        >
          + Add block
        </button>
      )}
    </div>
  );
}

function BlockEditor({ block, itemId, lessonId, onPatch }: {
  block: LmsContentBlock;
  itemId: string;
  lessonId: string;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  switch (block.type) {
    case 'text':
      return (
        <TiptapEditor
          value={block.text_content}
          onChange={(doc) => onPatch({ text_content: doc })}
          placeholder="Write lesson content…"
        />
      );
    case 'image':
      return (
        <div className="space-y-2">
          <MediaUploader
            itemId={itemId}
            lessonId={lessonId}
            fileCategory="image"
            accept="image/*"
            current={{ url: block.file_url, name: block.file_name }}
            onUploaded={(f) => onPatch({ file_url: f.url, file_name: f.name, file_size: f.size, mime_type: f.mime_type })}
          />
          {block.file_url && <img src={block.file_url} alt={block.caption || ''} className="max-h-64 rounded-md border border-divider" />}
          <CaptionInput value={block.caption} onChange={(caption) => onPatch({ caption })} />
        </div>
      );
    case 'video_upload':
      return (
        <div className="space-y-2">
          <MediaUploader
            itemId={itemId}
            lessonId={lessonId}
            fileCategory="video"
            accept="video/*"
            current={{ url: block.file_url, name: block.file_name }}
            onUploaded={(f) => onPatch({ file_url: f.url, file_name: f.name, file_size: f.size, mime_type: f.mime_type })}
          />
          {block.file_url && <video src={block.file_url} controls className="max-h-64 w-full rounded-md" />}
          <CaptionInput value={block.caption} onChange={(caption) => onPatch({ caption })} />
        </div>
      );
    case 'video_embed':
      return (
        <div className="space-y-2">
          <VideoEmbedInput
            url={block.embed_url}
            onChange={(val) => {
              if (val) onPatch({ embed_url: val.url, embed_provider: val.provider });
              else onPatch({ embed_url: null, embed_provider: null });
            }}
          />
          {block.embed_url && (
            <div className="rounded-md border border-divider bg-surface-alt p-2 text-[12px] text-foreground-muted">
              Preview: <span className="text-foreground">{block.embed_provider}</span> — <span className="font-mono">{block.embed_url}</span>
            </div>
          )}
          <CaptionInput value={block.caption} onChange={(caption) => onPatch({ caption })} />
        </div>
      );
    case 'audio':
      return (
        <div className="space-y-2">
          <MediaUploader
            itemId={itemId}
            lessonId={lessonId}
            fileCategory="audio"
            accept="audio/*"
            current={{ url: block.file_url, name: block.file_name }}
            onUploaded={(f) => onPatch({ file_url: f.url, file_name: f.name, file_size: f.size, mime_type: f.mime_type })}
          />
          {block.file_url && <audio src={block.file_url} controls className="w-full" />}
          <CaptionInput value={block.caption} onChange={(caption) => onPatch({ caption })} />
        </div>
      );
    case 'pdf':
      return (
        <div className="space-y-2">
          <MediaUploader
            itemId={itemId}
            lessonId={lessonId}
            fileCategory="file"
            accept="application/pdf"
            current={{ url: block.file_url, name: block.file_name }}
            onUploaded={(f) => onPatch({ file_url: f.url, file_name: f.name, file_size: f.size, mime_type: f.mime_type })}
          />
          <CaptionInput value={block.caption} onChange={(caption) => onPatch({ caption })} />
        </div>
      );
    case 'quiz':
      return <QuizEditor blockId={block.id} questions={block.quiz_questions || []} itemId={itemId} />;
    default:
      return null;
  }
}

function CaptionInput({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      defaultValue={value || ''}
      onBlur={(e) => {
        if (e.target.value !== (value || '')) onChange(e.target.value);
      }}
      placeholder="Caption (optional)"
      className="w-full rounded-md border border-divider bg-surface px-3 py-1.5 text-[13px] placeholder-foreground-dim focus:border-ink focus:outline-none"
    />
  );
}
