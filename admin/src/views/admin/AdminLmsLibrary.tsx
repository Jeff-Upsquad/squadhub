'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsItem, LmsItemStatus, LmsItemKind, LmsCategory } from '@squadhub/shared';

const STATUS_COLORS: Record<LmsItemStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  published: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-amber-50 text-amber-700',
};

const KIND_LABELS: Record<LmsItemKind, string> = {
  post: 'Post',
  course: 'Course',
};

export default function AdminLmsLibrary() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [kindFilter, setKindFilter] = useState<LmsItemKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<LmsItemStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const queryParams = new URLSearchParams();
  if (kindFilter) queryParams.set('kind', kindFilter);
  if (statusFilter) queryParams.set('status', statusFilter);
  if (categoryFilter) queryParams.set('category_id', categoryFilter);

  const { data: itemsRes } = useQuery({
    queryKey: ['lms-items', kindFilter, statusFilter, categoryFilter],
    queryFn: () => api.get(`/admin/lms/items?${queryParams.toString()}`).then((r) => r.data),
  });
  const items: LmsItem[] = itemsRes?.data || [];

  const { data: catRes } = useQuery({
    queryKey: ['lms-categories'],
    queryFn: () => api.get('/admin/lms/categories').then((r) => r.data),
  });
  const categories: LmsCategory[] = catRes?.data || [];

  const createItem = useMutation({
    mutationFn: (body: any) => api.post('/admin/lms/items', body).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['lms-items'] });
      setShowNewMenu(false);
      if (res?.data?.id) router.push(`/admin/learning/${res.data.id}`);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to create'),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-items'] }),
  });

  function onNew(kind: LmsItemKind) {
    const title = prompt(`New ${kind} title`);
    if (!title) return;
    createItem.mutate({ kind, title });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Learning Library</h1>
          <p className="mt-1 text-sm text-[#62748E]">Publish training posts and courses to internal team, clients and partners.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/learning/categories"
            className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-sm font-medium text-[#62748E] hover:bg-[#F8FAFC]"
          >
            Categories
          </Link>
          <div className="relative">
            <button
              onClick={() => setShowNewMenu((v) => !v)}
              className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
            >
              + New content
            </button>
            {showNewMenu && (
              <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-[#E2E8F0] bg-white shadow-lg">
                <button
                  onClick={() => onNew('post')}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#F8FAFC]"
                >
                  <span className="text-sm font-medium text-[#0F172B]">Post</span>
                  <span className="text-[11px] text-[#62748E]">Self-contained update</span>
                </button>
                <button
                  onClick={() => onNew('course')}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#F8FAFC]"
                >
                  <span className="text-sm font-medium text-[#0F172B]">Course</span>
                  <span className="text-[11px] text-[#62748E]">Multi-lesson journey</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={!kindFilter} onClick={() => setKindFilter('')} label="All kinds" />
        <FilterChip active={kindFilter === 'post'} onClick={() => setKindFilter('post')} label="Posts" />
        <FilterChip active={kindFilter === 'course'} onClick={() => setKindFilter('course')} label="Courses" />
        <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />
        <FilterChip active={!statusFilter} onClick={() => setStatusFilter('')} label="All statuses" />
        <FilterChip active={statusFilter === 'draft'} onClick={() => setStatusFilter('draft')} label="Draft" />
        <FilterChip active={statusFilter === 'published'} onClick={() => setStatusFilter('published')} label="Published" />
        {categories.length > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[12px] text-[#62748E] focus:border-[#0F172B] focus:outline-none"
            >
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-10 text-center">
          <p className="text-sm text-[#62748E]">No learning content yet.</p>
          <p className="mt-1 text-[12px] text-[#90A1B9]">Click "New content" to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC]">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Title</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Kind</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Audience</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Assigned</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Updated</th>
                <th className="w-1 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3">
                    <Link href={`/admin/learning/${item.id}`} className="block">
                      <div className="font-medium text-[#0F172B]">{item.title}</div>
                      {item.category && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#62748E]">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.category.color }} />
                          {item.category.name}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#62748E]">{KIND_LABELS[item.kind]}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#62748E]">
                    {(item.audience_types || []).length > 0 ? (item.audience_types || []).join(', ') : <span className="text-[#90A1B9]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[#62748E]">{item.assignment_count ?? 0}</td>
                  <td className="px-4 py-3 text-[#62748E]">{new Date(item.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm(`Delete "${item.title}"?`)) deleteItem.mutate(item.id); }}
                      className="text-[12px] text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] transition ${
        active ? 'bg-[#0F172B] text-white' : 'border border-[#E2E8F0] bg-white text-[#62748E] hover:bg-[#F8FAFC]'
      }`}
    >
      {label}
    </button>
  );
}
