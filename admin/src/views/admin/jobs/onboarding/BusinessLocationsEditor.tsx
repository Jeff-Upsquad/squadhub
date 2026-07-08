'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BusinessLocation } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { Field, inputCls } from './BusinessProfileForm';

// Saved interview venues on a business profile — reused as the location
// dropdown when scheduling physical interviews (InterviewScheduleDialog).

type LocationDraft = {
  label: string;
  address: string;
  city: string;
  region: string;
  postal_code: string;
  google_maps_url: string;
  is_primary: boolean;
};

const EMPTY_DRAFT: LocationDraft = {
  label: '',
  address: '',
  city: '',
  region: '',
  postal_code: '',
  google_maps_url: '',
  is_primary: false,
};

function toDraft(l: BusinessLocation): LocationDraft {
  return {
    label: l.label,
    address: l.address,
    city: l.city ?? '',
    region: l.region ?? '',
    postal_code: l.postal_code ?? '',
    google_maps_url: l.google_maps_url ?? '',
    is_primary: l.is_primary,
  };
}

export default function BusinessLocationsEditor({ businessProfileId }: { businessProfileId: string }) {
  const qc = useQueryClient();
  // null = closed, 'new' = creating, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_DRAFT);

  const { data: locationsRes, isLoading } = useQuery({
    queryKey: ['admin-job-business-locations', businessProfileId],
    queryFn: () =>
      api.get(`/admin/jobs/business-profiles/${businessProfileId}/locations`).then((r) => r.data),
  });
  const locations: BusinessLocation[] = locationsRes?.data || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-business-locations', businessProfileId] });
    qc.invalidateQueries({ queryKey: ['admin-job-business-profile', businessProfileId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        label: draft.label.trim(),
        address: draft.address.trim(),
        city: draft.city.trim() || null,
        region: draft.region.trim() || null,
        postal_code: draft.postal_code.trim() || null,
        google_maps_url: draft.google_maps_url.trim() || null,
        is_primary: draft.is_primary,
      };
      if (editing === 'new') {
        return api.post(`/admin/jobs/business-profiles/${businessProfileId}/locations`, body);
      }
      return api.patch(`/admin/jobs/business-locations/${editing}`, body);
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setDraft(EMPTY_DRAFT);
      showToast('Location saved.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save location', 'error');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/jobs/business-locations/${id}`),
    onSuccess: () => {
      invalidate();
      showToast('Location removed.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to remove location', 'error');
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Locations</p>
          <p className="text-[11px] text-foreground-dim">
            Saved venues — offered as the dropdown when scheduling physical interviews.
          </p>
        </div>
        {editing === null && (
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setEditing('new');
            }}
            className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground"
          >
            + Add location
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="py-2 text-xs text-foreground-dim">Loading…</p>
      ) : locations.length === 0 && editing === null ? (
        <p className="rounded-lg border border-dashed border-divider px-3 py-3 text-center text-xs text-foreground-dim">
          No locations yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {locations.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 rounded-lg border border-divider bg-surface px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {l.label}
                  {l.is_primary && (
                    <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">Primary</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  {[l.address, l.city, l.region].filter(Boolean).join(', ')}
                </p>
                {l.google_maps_url && (
                  <a
                    href={l.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-block text-[11px] text-accent underline-offset-2 hover:underline"
                  >
                    Google Maps ↗
                  </a>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(toDraft(l));
                    setEditing(l.id);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas hover:text-foreground"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove location "${l.label}"?`)) remove.mutate(l.id);
                  }}
                  disabled={remove.isPending}
                  className="rounded-md px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <div className="space-y-3 rounded-lg border border-divider bg-surface-alt p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Label" required>
              <input type="text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Head Office" className={inputCls} />
            </Field>
            <Field label="City">
              <input type="text" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Address" required>
            <textarea rows={2} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className={`${inputCls} resize-none`} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="State / region">
              <input type="text" value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Postal code">
              <input type="text" value={draft.postal_code} onChange={(e) => setDraft({ ...draft, postal_code: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Google Maps link" hint="Shared with candidates called for a physical interview.">
            <input type="text" value={draft.google_maps_url} onChange={(e) => setDraft({ ...draft, google_maps_url: e.target.value })} placeholder="https://maps.google.com/…" className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <input
              type="checkbox"
              checked={draft.is_primary}
              onChange={(e) => setDraft({ ...draft, is_primary: e.target.checked })}
            />
            Primary location
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(EMPTY_DRAFT);
              }}
              className="rounded-md border border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!draft.label.trim() || !draft.address.trim()) {
                  showToast('Label and address are required.', 'error');
                  return;
                }
                save.mutate();
              }}
              disabled={save.isPending}
              className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save location'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
