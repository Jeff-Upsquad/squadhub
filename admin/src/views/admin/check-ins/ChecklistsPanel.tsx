import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { Role, CheckInConfigItem } from '@squadhub/shared';

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function ChecklistsPanel() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [items, setItems] = useState<CheckInConfigItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: configsRes } = useQuery({
    queryKey: ['admin-checkin-configs'],
    queryFn: () => api.get('/admin/checkin/configs').then((r) => r.data),
  });

  const configs: { role: Role; config: { items: CheckInConfigItem[] } }[] = configsRes?.data || [];

  const saveMutation = useMutation({
    mutationFn: (data: { roleId: string; items: CheckInConfigItem[] }) =>
      api.put(`/admin/checkin/configs/${data.roleId}`, { items: data.items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-checkin-configs'] });
      setHasChanges(false);
    },
  });

  function selectRole(roleId: string) {
    const config = configs.find((c) => c.role.id === roleId);
    setSelectedRoleId(roleId);
    setItems(config?.config?.items || []);
    setHasChanges(false);
  }

  function addItem() {
    const newItem: CheckInConfigItem = {
      id: generateId(),
      label: '',
      description: '',
      isRequired: false,
      order: items.length,
    };
    setItems([...items, newItem]);
    setHasChanges(true);
  }

  function updateItem(id: string, updates: Partial<CheckInConfigItem>) {
    setItems(items.map((i) => (i.id === id ? { ...i, ...updates } : i)));
    setHasChanges(true);
  }

  function removeItem(id: string) {
    setItems(items.filter((i) => i.id !== id).map((i, idx) => ({ ...i, order: idx })));
    setHasChanges(true);
  }

  function moveItem(id: string, direction: 'up' | 'down') {
    const idx = items.findIndex((i) => i.id === id);
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === items.length - 1)) return;
    const newItems = [...items];
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    [newItems[idx], newItems[swap]] = [newItems[swap], newItems[idx]];
    setItems(newItems.map((i, j) => ({ ...i, order: j })));
    setHasChanges(true);
  }

  return (
    <div className="flex gap-6">
      <div className="w-56 shrink-0">
        <div className="rounded-xl border border-[#E2E8F0] bg-white">
          <div className="border-b border-[#E2E8F0] px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Roles</h3>
          </div>
          <div className="p-2">
            {configs.map(({ role }) => (
              <button
                key={role.id}
                onClick={() => selectRole(role.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  selectedRoleId === role.id
                    ? 'bg-[#F1F5F9] font-medium text-[#0F172B]'
                    : 'text-[#62748E] hover:bg-[#F8FAFC]'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: role.color }} />
                {role.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1">
        {!selectedRoleId ? (
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#90A1B9]">
            Select a role to configure its checklist items
          </div>
        ) : (
          <div className="rounded-xl border border-[#E2E8F0] bg-white">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3">
              <h3 className="text-sm font-semibold text-[#0F172B]">
                {configs.find((c) => c.role.id === selectedRoleId)?.role.name} - Checklist Items
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={addItem}
                  className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC]"
                >
                  + Add Item
                </button>
                {hasChanges && (
                  <button
                    onClick={() => saveMutation.mutate({ roleId: selectedRoleId, items })}
                    disabled={saveMutation.isPending}
                    className="rounded-lg bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D]"
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#90A1B9]">
                No checklist items. Click "Add Item" to create one.
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {items.sort((a, b) => a.order - b.order).map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-5 py-4">
                    <div className="flex flex-col gap-0.5 pt-1">
                      <button onClick={() => moveItem(item.id, 'up')} className="rounded p-0.5 text-[#90A1B9] hover:text-[#0F172B]">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button onClick={() => moveItem(item.id, 'down')} className="rounded p-0.5 text-[#90A1B9] hover:text-[#0F172B]">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>

                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => updateItem(item.id, { label: e.target.value })}
                        placeholder="Item label (required)"
                        className="w-full rounded border border-[#E2E8F0] px-3 py-1.5 text-sm focus:border-[#0F172B] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                        placeholder="Description (optional)"
                        className="w-full rounded border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#62748E] focus:border-[#0F172B] focus:outline-none"
                      />
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.isRequired}
                          onChange={(e) => updateItem(item.id, { isRequired: e.target.checked })}
                          className="rounded border-[#CBD5E1]"
                        />
                        <span className="text-xs text-[#62748E]">Required</span>
                      </label>
                    </div>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="rounded p-1 text-[#90A1B9] hover:text-red-500"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
