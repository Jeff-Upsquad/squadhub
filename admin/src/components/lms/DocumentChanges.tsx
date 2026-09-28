'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import TiptapEditor from './TiptapEditor';

type Version = { id: string; changed_at: string; change_label: string; page_title: string | null };
type SnapshotBlock = {
  id: string; type: string; text_content?: unknown; caption?: string;
  file_url?: string; file_name?: string; embed_url?: string;
  videos?: { language: string; file_url?: string; embed_url?: string }[];
  quiz_questions?: { id: string; prompt: string; options: { id: string; text?: string; label?: string }[]; correct_option_id?: string; explanation?: string }[];
};
type SnapshotPage = { id: string; title: string; summary?: string; is_active?: boolean; blocks: SnapshotBlock[] };
type Detail = Version & { snapshot: { document: { title: string; summary?: string }; pages: SnapshotPage[] } };
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
// Historical URLs remain untrusted content, including imported knowledge.
function safeUrl(value?: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol)) return url.href; } catch { /* no unsafe links */ }
}

export default function DocumentChanges({ itemId, lessonId, revision }: { itemId: string; lessonId: string; revision: unknown }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [versionId, setVersionId] = useState<string | null>(null);
  const qc = useQueryClient();
  const lessonQuery = `lesson_id=${encodeURIComponent(lessonId)}`;
  const base = `/admin/lms/items/${itemId}/changes`;
  const list = useQuery({
    queryKey: ['document-changes', itemId, lessonId, page], enabled: open && !versionId,
    queryFn: () => api.get(`${base}?${lessonQuery}&page=${page}`).then(r => r.data as { data: Version[]; has_more: boolean }),
  });
  const detail = useQuery({
    queryKey: ['document-change', itemId, lessonId, versionId], enabled: open && !!versionId,
    queryFn: () => api.get(`${base}/${versionId}?${lessonQuery}`).then(r => r.data.data as Detail),
  });
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['document-changes', itemId] }); }, [qc, itemId, revision]);
  useEffect(() => { setPage(0); setVersionId(null); }, [lessonId]);
  const snapshot = detail.data?.snapshot;
  const selectedPage = snapshot?.pages.find(p => p.id === lessonId);

  return (
    <section className="document-changes" data-document-history aria-label="Document changes">
      <button type="button" className="changes-toggle" aria-expanded={open} onClick={() => { setOpen(!open); setVersionId(null); }}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Changes
      </button>
      {open && <div className="changes-body">
        {versionId ? <>
          <button type="button" className="changes-link" onClick={() => setVersionId(null)}>← Page changes</button>
          {detail.isLoading && <p role="status">Loading previous version…</p>}
          {detail.isError && <p role="alert">Could not load this version. <button type="button" onClick={() => detail.refetch()}>Retry</button></p>}
          {detail.data && <article aria-label="Previous page version">
            <p className="changes-caption">Read-only · Before {date(detail.data.changed_at)}</p>
            <h2>{snapshot?.document.title}</h2>
            {snapshot?.document.summary && <p>{snapshot.document.summary}</p>}
            {selectedPage ? <>
              <h3>{selectedPage.title}</h3>
              {selectedPage.summary && <p>{selectedPage.summary}</p>}
              {selectedPage.blocks.length === 0 && <p>This page had no content.</p>}
              {selectedPage.blocks.map(block => <div key={block.id} className="changes-block">
                {block.type === 'text' ? <TiptapEditor value={block.text_content ?? null} onChange={() => {}} readOnly /> : <>
                  {block.type === 'image' && safeUrl(block.file_url) && <img src={safeUrl(block.file_url)} alt={block.caption || block.file_name || 'Previous image'} />}
                  {block.file_url && safeUrl(block.file_url) && <a href={safeUrl(block.file_url)} target="_blank" rel="noopener noreferrer">{block.file_name || `Open ${block.type}`}</a>}
                  {block.embed_url && safeUrl(block.embed_url) && <a href={safeUrl(block.embed_url)} target="_blank" rel="noopener noreferrer">Open embedded video</a>}
                  {block.caption && <p>{block.caption}</p>}
                  {block.videos?.map(v => <p key={v.language}><a href={safeUrl(v.file_url || v.embed_url)} target="_blank" rel="noopener noreferrer">Video · {v.language}</a></p>)}
                  {block.quiz_questions?.map(q => <div key={q.id}><p><strong>{q.prompt}</strong></p><ul>{q.options.map(o => <li key={o.id}>{o.text || o.label || o.id}{q.correct_option_id === o.id ? ' ✓' : ''}</li>)}</ul>{q.explanation && <p>{q.explanation}</p>}</div>)}
                </>}
              </div>)}
            </> : <p>This page did not exist before this change.</p>}
          </article>}
        </> : <>
          <p className="changes-caption">Previous versions of this page. Open a change to see the content before it was saved.</p>
          {list.isLoading && <p role="status">Loading changes…</p>}
          {list.isError && <p role="alert">Could not load changes. <button type="button" onClick={() => list.refetch()}>Retry</button></p>}
          {list.data?.data.length === 0 && <p>No previous versions yet. Future saved changes will appear here.</p>}
          <ul className="changes-list">{list.data?.data.map(v => <li key={v.id}>
            <button type="button" onClick={() => setVersionId(v.id)}>
              <span>{v.change_label}{v.page_title ? ` · ${v.page_title}` : ''}</span>
              <time dateTime={v.changed_at}>{date(v.changed_at)}</time>
            </button>
          </li>)}</ul>
          {(page > 0 || list.data?.has_more) && <nav className="changes-pagination" aria-label="Changes pagination">
            <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Newer</button>
            <span>Page {page + 1}</span>
            <button type="button" disabled={!list.data?.has_more} onClick={() => setPage(p => p + 1)}>Older</button>
          </nav>}
        </>}
      </div>}
      <style jsx>{`
        .document-changes { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--sh-hair, #cbd5e1); color: var(--sh-ink, inherit); font-size: 14px; }
        button { cursor: pointer; text-align: left; } button:disabled { opacity: .4; cursor: default; }
        .changes-toggle { display: flex; gap: 8px; align-items: center; font-weight: 600; padding: 8px 0; }
        .changes-body { margin-top: 12px; } .changes-caption, time { opacity: .65; font-size: 12px; }
        .changes-list { list-style: none; padding: 0; margin: 16px 0; }
        .changes-list li { border-bottom: 1px solid var(--sh-hair, #cbd5e1); }
        .changes-list button { width: 100%; padding: 14px 8px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; border-radius: 6px; }
        .changes-list button:hover { background: var(--sh-hair-3, #f1f5f9); }
        .changes-link, a { color: #2563eb; text-decoration: underline; }
        article { margin-top: 20px; padding: 24px; border: 1px solid var(--sh-hair, #cbd5e1); border-radius: 10px; }
        h2 { font-size: 22px; font-weight: 650; margin: 12px 0; } h3 { font-size: 18px; font-weight: 600; margin: 24px 0 12px; }
        p { margin: 10px 0; }
        .changes-block { margin: 16px 0; } img { max-width: 100%; height: auto; border-radius: 8px; }
        .changes-pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
      `}</style>
    </section>
  );
}
