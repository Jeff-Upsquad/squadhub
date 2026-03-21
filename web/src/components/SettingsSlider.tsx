import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { ResourceType } from '@squadhub/shared';

type SettingsSliderProps = {
  type: ResourceType;
  id: string;
  name: string;
  description?: string | null;
  spaceId?: string | null;
  onClose: () => void;
  onDeleted?: () => void;
};

export default function SettingsSlider({ type, id, name, description, spaceId, onClose, onDeleted }: SettingsSliderProps) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const endpoint = type === 'channel' ? `/channels/${id}` : `/pm/${type}s/${id}`;

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.put(endpoint, body);
      return res.data.data;
    },
    onSuccess: () => {
      setSaving(false);
      setError('');
      // Invalidate relevant queries
      if (type === 'channel') {
        qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      } else if (type === 'space') {
        qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
        qc.invalidateQueries({ queryKey: ['space', id] });
      } else {
        qc.invalidateQueries({ queryKey: ['space', spaceId] });
      }
    },
    onError: (err: any) => {
      setSaving(false);
      setError(err.response?.data?.error || 'Failed to save');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(endpoint);
    },
    onSuccess: () => {
      if (type === 'channel') {
        qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      } else if (type === 'space') {
        qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
      } else {
        qc.invalidateQueries({ queryKey: ['space', spaceId] });
      }
      onDeleted?.();
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to delete');
    },
  });

  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    if (editName !== name) updates.name = editName;
    if (editDesc !== (description || '')) updates.description = editDesc || null;
    if (Object.keys(updates).length === 0) return;
    setSaving(true);
    updateMutation.mutate(updates);
  };

  const handleDelete = () => {
    if (confirm(`Delete ${type} "${name}"? It will be moved to trash.`)) {
      deleteMutation.mutate();
    }
  };

  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-[#E2E8F0] bg-[#F8FAFC]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
        <h3 className="text-sm font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          {typeLabel} Settings
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-[#999999] hover:text-[#0F172B]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[#666666] uppercase tracking-wide">Name</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
          />
        </div>

        {/* Description */}
        {(type === 'channel' || type === 'space') && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[#666666] uppercase tracking-wide">Description</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none resize-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder={`Add a description for this ${type}...`}
            />
          </div>
        )}

        {/* Save button */}
        {(editName !== name || editDesc !== (description || '')) && (
          <button
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="w-full rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        {/* Info */}
        <div className="border-t border-[#E2E8F0] pt-4">
          <p className="text-xs text-[#999999]">
            <span className="font-medium text-[#666666]">Type:</span> {typeLabel}
          </p>
          <p className="mt-1 text-xs text-[#999999]">
            <span className="font-medium text-[#666666]">ID:</span> {id}
          </p>
        </div>
      </div>

      {/* Danger zone at bottom */}
      <div className="border-t border-[#E2E8F0] p-4">
        <p className="mb-2 text-xs font-medium text-[#666666] uppercase tracking-wide">Danger Zone</p>
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="w-full rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
        >
          {deleteMutation.isPending ? 'Deleting...' : `Delete ${typeLabel}`}
        </button>
        <p className="mt-1.5 text-[10px] text-[#999999]">
          This {type} will be moved to trash. An admin can restore it later.
        </p>
      </div>
    </div>
  );
}
