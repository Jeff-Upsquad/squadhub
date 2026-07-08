'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BrandProfile, BusinessProfilePhoto } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import ImageUploadField from '../ImageUploadField';
import { Field, inputCls, PhotoListEditor } from './BusinessProfileForm';

// Brand profile — optional 0..n per business. A job profile can hang off the
// business directly or off one of its brands.

const SOCIAL_KEYS = ['linkedin', 'instagram', 'facebook', 'x', 'youtube'] as const;

export default function BrandProfileForm({
  businessProfileId,
  brand,
  onSaved,
  onCancel,
}: {
  businessProfileId: string;
  /** Existing brand to edit, or null to create. */
  brand: BrandProfile | null;
  onSaved: (brand: BrandProfile) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(brand?.name ?? '');
  const [about, setAbout] = useState(brand?.about ?? '');
  const [industry, setIndustry] = useState(brand?.industry ?? '');
  const [website, setWebsite] = useState(brand?.website ?? '');
  const [socials, setSocials] = useState<Record<string, string>>(brand?.socials ?? {});
  const [logoUrl, setLogoUrl] = useState(brand?.logo_url ?? '');
  const [photos, setPhotos] = useState<BusinessProfilePhoto[]>(brand?.photos ?? []);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        about: about.trim() || null,
        industry: industry.trim() || null,
        website: website.trim() || null,
        socials: Object.fromEntries(Object.entries(socials).filter(([, v]) => v.trim())),
        logo_url: logoUrl.trim() || null,
        photos: photos.filter((p) => p.url.trim()),
      };
      const res = brand
        ? await api.patch(`/admin/jobs/brand-profiles/${brand.id}`, body)
        : await api.post(`/admin/jobs/business-profiles/${businessProfileId}/brands`, body);
      return res.data?.data as BrandProfile;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['admin-job-business-profile', businessProfileId] });
      showToast(brand ? 'Brand profile updated.' : 'Brand profile created.', 'success');
      onSaved(saved);
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save brand profile', 'error');
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          showToast('Brand name is required.', 'error');
          return;
        }
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Brand name" required>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="About the brand">
        <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} className={`${inputCls} resize-none`} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Website">
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className={inputCls} />
        </Field>
      </div>
      <Field label="Logo">
        <ImageUploadField kind="logo" variant="logo" value={logoUrl || null} onChange={(url) => setLogoUrl(url ?? '')} />
      </Field>
      <Field label="Social links">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SOCIAL_KEYS.map((k) => (
            <input
              key={k}
              type="text"
              value={socials[k] ?? ''}
              onChange={(e) => setSocials({ ...socials, [k]: e.target.value })}
              placeholder={`${k.charAt(0).toUpperCase() + k.slice(1)} URL`}
              className={inputCls}
            />
          ))}
        </div>
      </Field>
      <Field label="Photos">
        <PhotoListEditor photos={photos} onChange={setPhotos} />
      </Field>
      <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
        )}
        <button type="submit" disabled={save.isPending} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {save.isPending ? 'Saving…' : brand ? 'Save changes' : 'Create brand'}
        </button>
      </div>
    </form>
  );
}
