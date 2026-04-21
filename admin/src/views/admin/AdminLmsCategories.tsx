'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsCategory } from '@squadhub/shared';

export default function AdminLmsCategories() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; color: string } | null>(null);

  const { data: res } = useQuery({
    queryKey: ['lms-categories'],
    queryFn: () => api.get('/admin/lms/categories').then((r) => r.data),
  });
  const categories: LmsCategory[] = res?.data || [];

  const createCategory = useMutation({
    mutationFn: (body: any) => api.post('/admin/lms/categories', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-categories'] });
      setDraft(null);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to create'),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/admin/lms/categories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-categories'] }),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lms/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-categories'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Learning Categories</h1>
          <p className="mt-1 text-sm text-[#62748E]">Group posts and courses so learners can filter your library.</p>
        </div>
        <button
          onClick={() => setDraft({ name: '', color: '#6b7280' })}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
        >
          Add Category
        </button>
      </div>

      <div className="max-w-2xl space-y-2">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c}
            onSave={(patch) => updateCategory.mutate({ id: c.id, ...patch })}
            onDelete={() => { if (confirm(`Delete category "${c.name}"?`)) deleteCategory.mutate(c.id); }}
          />
        ))}

        {draft && (
          <div className="rounded-lg border border-[#CBD5E1] bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="h-9 w-9 cursor-pointer rounded"
              />
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Category name"
                className="flex-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => {
                  if (!draft.name.trim()) return;
                  createCategory.mutate(draft);
                }}
                className="rounded-md bg-[#0F172B] px-3 py-2 text-sm font-medium text-white"
              >
                Save
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#62748E]">Cancel</button>
            </div>
          </div>
        )}

        {categories.length === 0 && !draft && (
          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-8 text-center text-sm text-[#90A1B9]">
            No categories yet. Add one to start grouping your learning content.
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category, onSave, onDelete }: {
  category: LmsCategory;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);

  if (editing) {
    return (
      <div className="rounded-lg border border-[#CBD5E1] bg-white p-3">
        <div className="flex items-center gap-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-9 cursor-pointer rounded" />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
          <button onClick={() => { onSave({ name, color }); setEditing(false); }} className="rounded-md bg-[#0F172B] px-3 py-2 text-sm font-medium text-white">Save</button>
          <button onClick={() => { setName(category.name); setColor(category.color); setEditing(false); }} className="rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#62748E]">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3">
      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
      <span className="flex-1 text-sm font-medium text-[#0F172B]">{category.name}</span>
      <span className="font-mono text-[11px] text-[#90A1B9]">{category.slug}</span>
      <button onClick={() => setEditing(true)} className="rounded px-2 py-1 text-[12px] text-[#62748E] hover:bg-[#F8FAFC]">Edit</button>
      <button onClick={onDelete} className="rounded px-2 py-1 text-[12px] text-red-600 hover:bg-red-50">Delete</button>
    </div>
  );
}
