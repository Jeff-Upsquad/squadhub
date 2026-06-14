import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Country, PartnerTier } from '@squadhub/shared';
import { PARTNER_TIERS, SUPPORTED_LANGUAGES } from '@squadhub/shared';
import api from '../../services/api';

interface PartnerAssignment {
  id: string;
  user_id: string;
  client_id: string;
  role: string | null;
  created_at: string;
  client?: { id: string; business_name: string; status: string };
}

interface PartnerUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  user_type: string;
  status: string;
  tier: PartnerTier | null;
  min_experience_years: number | null;
  country_id: string | null;
  state_region: string | null;
  languages: string[];
  assignments: PartnerAssignment[];
}

interface ClientOption {
  id: string;
  business_name: string;
}

/* ─────────────────── Assign Client Modal ─────────────────── */
function AssignClientModal({
  partnerId,
  partnerName,
  existingClientIds,
  onClose,
}: {
  partnerId: string;
  partnerName: string;
  existingClientIds: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');

  const { data: clientsRes } = useQuery({
    queryKey: ['admin-clients-list'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });

  const clients: ClientOption[] = (clientsRes?.data || []).filter(
    (c: ClientOption) => !existingClientIds.includes(c.id)
  );

  const assignMutation = useMutation({
    mutationFn: (data: { client_id: string; role?: string }) =>
      api.post(`/admin/partners/${partnerId}/assignments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-partners'] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to assign client');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) { setError('Select a client'); return; }
    assignMutation.mutate({ client_id: clientId, role: role || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-foreground">Assign Client to {partnerName}</h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.business_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-muted">Role / Specialty</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Designer, Editor, Accountant"
              className="mt-1 w-full rounded-lg border border-divider px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-divider px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt">
              Cancel
            </button>
            <button
              type="submit"
              disabled={assignMutation.isPending}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {assignMutation.isPending ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────── Main Component ─────────────────── */
export default function AdminPartners() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [assignModal, setAssignModal] = useState<{ partnerId: string; partnerName: string; existingClientIds: string[] } | null>(null);

  const { data: partnersRes, isLoading } = useQuery({
    queryKey: ['admin-partners', search],
    queryFn: () => api.get(`/admin/partners?search=${encodeURIComponent(search)}`).then((r) => r.data),
  });

  const partners: PartnerUser[] = partnersRes?.data || [];

  const removeMutation = useMutation({
    mutationFn: ({ userId, assignmentId }: { userId: string; assignmentId: string }) =>
      api.delete(`/admin/partners/${userId}/assignments/${assignmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-partners'] });
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Partners</h1>
          <p className="mt-1 text-sm text-foreground-muted">Manage partner users and their client assignments</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search partners..."
          className="w-full max-w-sm rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Partners list */}
      {isLoading ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : partners.length === 0 ? (
        <div className="rounded-xl border border-divider bg-surface p-12 text-center">
          <p className="text-sm text-foreground-muted">No partner users found</p>
          <p className="mt-1 text-xs text-foreground-dim">Invite partner users from the Invitations page with &quot;Partner&quot; user type</p>
        </div>
      ) : (
        <div className="space-y-4">
          {partners.map((partner) => (
            <div key={partner.id} className="rounded-xl border border-divider bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-sm font-semibold text-purple-700">
                    {partner.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{partner.display_name}</h3>
                    <p className="text-xs text-foreground-muted">{partner.email}</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setAssignModal({
                      partnerId: partner.id,
                      partnerName: partner.display_name,
                      existingClientIds: partner.assignments.map((a) => a.client_id),
                    })
                  }
                  className="rounded-lg border border-divider px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt"
                >
                  + Assign Client
                </button>
              </div>

              {/* Client assignments */}
              {partner.assignments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-foreground-dim">Assigned Clients</p>
                  {partner.assignments.map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {assignment.client?.business_name || 'Unknown'}
                        </span>
                        {assignment.role && (
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600">
                            {assignment.role}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeMutation.mutate({ userId: partner.id, assignmentId: assignment.id })}
                        className="text-xs text-red-500 hover:text-red-700"
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {partner.assignments.length === 0 && (
                <p className="mt-3 text-xs text-foreground-dim">No clients assigned</p>
              )}

              <div className="mt-5 border-t border-divider pt-4">
                <p className="text-xs font-medium uppercase tracking-wider text-foreground-dim">
                  Subscription Card Targeting
                </p>
                <PartnerTargetingEditor partner={partner} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assign modal */}
      {assignModal && (
        <AssignClientModal
          partnerId={assignModal.partnerId}
          partnerName={assignModal.partnerName}
          existingClientIds={assignModal.existingClientIds}
          onClose={() => setAssignModal(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────── Targeting Editor ─────────────────── */
function PartnerTargetingEditor({ partner }: { partner: PartnerUser }) {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<PartnerTier | ''>(partner.tier || '');
  const [minExp, setMinExp] = useState<string>(
    partner.min_experience_years == null ? '' : String(partner.min_experience_years),
  );
  const [countryId, setCountryId] = useState<string>(partner.country_id || '');
  const [region, setRegion] = useState<string>(partner.state_region || '');
  const [languages, setLanguages] = useState<string[]>(partner.languages || []);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTier(partner.tier || '');
    setMinExp(partner.min_experience_years == null ? '' : String(partner.min_experience_years));
    setCountryId(partner.country_id || '');
    setRegion(partner.state_region || '');
    setLanguages(partner.languages || []);
    setDirty(false);
  }, [partner]);

  const { data: countriesRes } = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/admin/partners/${partner.id}/targeting`, {
        tier: tier || null,
        min_experience_years: minExp === '' ? null : parseInt(minExp, 10) || 0,
        country_id: countryId || null,
        state_region: region || null,
        languages,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-partners'] });
      setDirty(false);
    },
    onError: (err: any) => alert(err?.response?.data?.error || 'Failed to save targeting'),
  });

  const mark = () => setDirty(true);

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Tier</label>
          <select
            value={tier}
            onChange={(e) => { setTier(e.target.value as PartnerTier | ''); mark(); }}
            className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
          >
            <option value="">Unset</option>
            {PARTNER_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Years of experience</label>
          <input
            type="number"
            min={0}
            value={minExp}
            onChange={(e) => { setMinExp(e.target.value); mark(); }}
            className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Country</label>
          <select
            value={countryId}
            onChange={(e) => { setCountryId(e.target.value); mark(); }}
            className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
          >
            <option value="">Unset</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">State / Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => { setRegion(e.target.value); mark(); }}
            placeholder="e.g. Tamil Nadu"
            className="w-full rounded-md border border-divider bg-surface px-2 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground-muted">Languages</label>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_LANGUAGES.map((l) => {
            const on = languages.includes(l.code);
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  setLanguages((prev) =>
                    on ? prev.filter((x) => x !== l.code) : [...prev, l.code],
                  );
                  mark();
                }}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                  on
                    ? 'border-ink bg-ink text-white'
                    : 'border-divider bg-surface text-foreground-muted hover:border-ink'
                }`}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save targeting'}
          </button>
        </div>
      )}
    </div>
  );
}
