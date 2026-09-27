import { useState } from 'react';
import ProviderBillingCard, { BILLING_MODES } from './squad-bots/ProviderBillingCard';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { AiProvider, AiProviderBillingSettings, AiProviderKind, SquadBot, SquadBotHomeApp, SquadBotStatus } from '@squadhub/shared';
import { HOME_APP_LABELS, StatusSwitch, errorMessage } from './squad-bots/shared';

interface Overview {
  bots: SquadBot[];
  providers: AiProvider[];
  settings: { all_paused: boolean };
}

export default function AdminSquadBots() {
  const qc = useQueryClient();
  const [showNewBot, setShowNewBot] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProvider | 'new' | null>(null);

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ['squad-bots'],
    queryFn: () => api.get('/admin/squad-bots').then((r) => r.data.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['squad-bots'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SquadBotStatus }) => api.patch(`/admin/squad-bots/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => alert(errorMessage(e, 'Could not change the status')),
  });
  const setPaused = useMutation({
    mutationFn: (all_paused: boolean) => api.put('/admin/squad-bots/settings', { all_paused }),
    onSuccess: refresh,
    onError: (e) => alert(errorMessage(e, 'Could not change the emergency stop')),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.post(`/admin/squad-bots/providers/${id}/default`),
    onSuccess: refresh,
    onError: (e) => alert(errorMessage(e, 'Could not set the default provider')),
  });

  const paused = data?.settings.all_paused ?? false;
  const defaultProvider = data?.providers.find((p) => p.is_default);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Squad Bots</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Every AI bot in one place: turn them on or off, choose their AI, assign jobs, review activity, and manage their knowledge docs.
          </p>
        </div>
        <button onClick={() => setShowNewBot(true)} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover">
          + New bot
        </button>
      </div>

      {/* Emergency stop */}
      <div
        className={`mb-6 flex items-center justify-between gap-4 rounded-xl border px-5 py-4 ${
          paused ? 'border-red-200 bg-red-50' : 'border-divider bg-surface'
        }`}
      >
        <div>
          <p className={`text-sm font-semibold ${paused ? 'text-red-700' : 'text-foreground'}`}>
            {paused ? 'All bots are paused' : 'Emergency stop'}
          </p>
          <p className={`mt-0.5 text-[12px] ${paused ? 'text-red-600' : 'text-foreground-muted'}`}>
            {paused
              ? 'Every bot is treated as Off until you resume. Their own settings are kept.'
              : 'Pause every bot at once. Each bot keeps its own setting for when you resume.'}
          </p>
        </div>
        <button
          disabled={setPaused.isPending || !data}
          onClick={() => {
            if (paused || confirm('Pause every Squad Bot now?')) setPaused.mutate(!paused);
          }}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            paused ? 'bg-ink text-white hover:bg-ink-hover' : 'border border-red-300 bg-surface text-red-600 hover:bg-red-50'
          }`}
        >
          {paused ? 'Resume bots' : 'Pause all bots'}
        </button>
      </div>

      {/* Bots */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : (
        <div className="space-y-3">
          {(data?.bots ?? []).map((bot) => (
            <div key={bot.id} className="rounded-xl border border-divider bg-surface px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xl" aria-hidden>🤖</span>
                    <Link href={`/admin/squad-bots/${bot.id}`} className="text-[15px] font-semibold text-foreground hover:underline">
                      {bot.internal_name}
                    </Link>
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] text-foreground-muted">
                      Customers see: <span className="font-medium text-foreground">{bot.public_name}</span>
                    </span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                      {HOME_APP_LABELS[bot.home_app]}
                    </span>
                  </div>
                  {bot.description && <p className="mt-1 text-[13px] text-foreground-muted">{bot.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-foreground-muted">
                    <span>
                      AI:{' '}
                      <span className="font-medium text-foreground">
                        {bot.ai.provider_name ? `${bot.ai.provider_name} · ${bot.ai.model}` : '—'}
                      </span>
                      {bot.ai.uses_default_provider && <span className="text-foreground-dim"> (default)</span>}
                    </span>
                    <Link href={`/admin/learning?track=knowledge&bot=${bot.id}`} className="hover:text-foreground hover:underline">
                      Knowledge docs: <span className="font-medium text-foreground">{bot.knowledge?.published ?? 0}</span> published
                      {(bot.knowledge?.total ?? 0) > (bot.knowledge?.published ?? 0) &&
                        ` · ${(bot.knowledge?.total ?? 0) - (bot.knowledge?.published ?? 0)} draft`}
                    </Link>
                    <span>
                      Today: <span className="font-medium text-foreground">{bot.runs_today?.total ?? 0}</span> AI calls
                      {(bot.runs_today?.failed ?? 0) > 0 && <span className="text-red-600"> · {bot.runs_today?.failed} failed</span>}
                    </span>
                    {!bot.api_key_prefix && <span className="text-amber-600">Not connected yet (no app key)</span>}
                  </div>
                  {bot.ai.problem && <p className="mt-1.5 text-[12px] text-red-600">⚠ {bot.ai.problem}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusSwitch
                    value={bot.status}
                    disabled={setStatus.isPending}
                    onChange={(status) => setStatus.mutate({ id: bot.id, status })}
                  />
                  {paused && bot.status !== 'off' && <span className="text-[11px] text-red-600">Paused by emergency stop</span>}
                  <Link href={`/admin/squad-bots/${bot.id}`} className="text-[12px] text-foreground-muted hover:text-foreground hover:underline">
                    Jobs, activity & settings →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI providers */}
      <div className="mt-10 mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">AI providers</h2>
          <p className="mt-0.5 text-[12px] text-foreground-muted">
            The default runs every bot unless a bot picks its own.
            {defaultProvider && (
              <>
                {' '}Default now: <span className="font-medium text-foreground">{defaultProvider.name}</span>.
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => setEditingProvider('new')}
          className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
        >
          + Add provider
        </button>
      </div>
      <p className="mb-3 text-[12px] text-foreground-dim">Amounts in USD. Monthly spend uses the calendar month in UTC. Provider reports may be delayed; refreshes are cached for one minute.</p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(data?.providers ?? []).map((p) => (
          <ProviderBillingCard key={p.id} provider={p} onEdit={() => setEditingProvider(p)} onMakeDefault={() => makeDefault.mutate(p.id)} defaultPending={makeDefault.isPending} />
        ))}
      </div>

      {showNewBot && <NewBotModal onClose={() => setShowNewBot(false)} onCreated={refresh} />}
      {editingProvider && (
        <ProviderModal provider={editingProvider === 'new' ? null : editingProvider} onClose={() => setEditingProvider(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-foreground-dim">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none';

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-divider bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function NewBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [internalName, setInternalName] = useState('');
  const [publicName, setPublicName] = useState('Squad Bot');
  const [description, setDescription] = useState('');
  const [homeApp, setHomeApp] = useState<SquadBotHomeApp>('other');
  const [workspaceId, setWorkspaceId] = useState('');
  const { data: workspaces, error: workspaceError } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ['bot-workspaces'], queryFn: () => api.get('/workspaces').then(r => r.data.data) });

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/squad-bots', {
        internal_name: internalName.trim(),
        public_name: publicName.trim() || 'Squad Bot',
        description: description.trim(),
        home_app: homeApp,
        workspace_id: workspaceId || workspaces?.[0]?.id,
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (e) => alert(errorMessage(e, 'Could not create the bot')),
  });

  return (
    <Modal title="New Squad Bot" onClose={onClose}>
      <p className="mt-1 text-[13px] text-foreground-muted">It starts Off. Set its AI and knowledge, try it, then switch it on.</p>
      <Field label="Channel workspace" hint="The bot gets a private channel here, with you as channel admin.">
        <select aria-label="Channel workspace" value={workspaceId || workspaces?.[0]?.id || ''} onChange={e => setWorkspaceId(e.target.value)} className={inputClass}>
          {!workspaces?.length && <option value="">No workspace available</option>}
          {workspaces?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {workspaceError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load workspaces</p>}
      </Field>
      <Field label="Internal name" hint="What your team calls it.">
        <input autoFocus value={internalName} onChange={(e) => setInternalName(e.target.value)} placeholder="e.g. Squad Support Bot" className={inputClass} />
      </Field>
      <Field label="Name customers see">
        <input value={publicName} onChange={(e) => setPublicName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="What it does">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Answers partner questions in the Partner app" className={inputClass} />
      </Field>
      <Field label="Where it works">
        <select value={homeApp} onChange={(e) => setHomeApp(e.target.value as SquadBotHomeApp)} className={inputClass}>
          {Object.entries(HOME_APP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt">Cancel</button>
        <button
          onClick={() => create.mutate()}
          disabled={!internalName.trim() || !workspaces?.length || create.isPending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create bot'}
        </button>
      </div>
    </Modal>
  );
}

function ProviderModal({ provider, onClose, onSaved }: { provider: AiProvider | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(provider?.name ?? '');
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? 'openai_compatible');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '');
  const [apiKeyEnv, setApiKeyEnv] = useState(provider?.api_key_env ?? '');
  const [defaultModel, setDefaultModel] = useState(provider?.default_model ?? '');
  const [enabled, setEnabled] = useState(provider?.is_enabled ?? true);
  const [billingMode, setBillingMode] = useState<AiProviderBillingSettings['mode']>(provider?.billing_settings?.mode ?? 'unknown');
  const [billingKeyEnv, setBillingKeyEnv] = useState(provider?.billing_settings?.key_env ?? '');
  const [manualBalance, setManualBalance] = useState(provider?.billing_settings?.manual?.balance_usd?.toString() ?? '');
  const [manualSpend, setManualSpend] = useState(provider?.billing_settings?.manual?.spend_usd?.toString() ?? '');
  const [manualAsOf, setManualAsOf] = useState((provider?.billing_settings?.manual?.as_of ?? new Date().toISOString()).slice(0, 16));
  const hasManual = manualBalance.trim() !== '' || manualSpend.trim() !== '';
  const validManual = !hasManual || (
    !!manualAsOf && Number.isFinite(Date.parse(`${manualAsOf}Z`)) && Date.parse(`${manualAsOf}Z`) <= Date.now() &&
    (manualBalance === '' || (Number.isFinite(Number(manualBalance)) && Math.abs(Number(manualBalance)) <= 1e9)) &&
    (manualSpend === '' || (Number.isFinite(Number(manualSpend)) && Number(manualSpend) >= 0 && Number(manualSpend) <= 1e9))
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        kind,
        base_url: baseUrl.trim() || null,
        api_key_env: apiKeyEnv.trim() || null,
        default_model: defaultModel.trim() || null,
        is_enabled: enabled,
        billing_settings: {
          mode: billingMode,
          key_env: billingKeyEnv.trim() || null,
          manual: hasManual ? {
            balance_usd: manualBalance.trim() === '' ? null : Number(manualBalance),
            spend_usd: manualSpend.trim() === '' ? null : Number(manualSpend),
            as_of: provider?.billing_settings?.manual?.as_of.slice(0, 16) === manualAsOf
              ? provider.billing_settings.manual.as_of
              : new Date(`${manualAsOf}Z`).toISOString(),
          } : null,
        },
      };
      return provider ? api.patch(`/admin/squad-bots/providers/${provider.id}`, body) : api.post('/admin/squad-bots/providers', body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => alert(errorMessage(e, 'Could not save the provider')),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/squad-bots/providers/${provider!.id}`),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => alert(errorMessage(e, 'Could not delete the provider')),
  });

  return (
    <Modal title={provider ? `Edit ${provider.name}` : 'Add AI provider'} onClose={onClose}>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groq (Llama)" className={inputClass} />
      </Field>
      <Field label="Type">
        <select value={kind} onChange={(e) => setKind(e.target.value as AiProviderKind)} className={inputClass}>
          <option value="anthropic">Claude API (Anthropic)</option>
          <option value="openai_compatible">OpenAI-compatible (OpenAI, OpenRouter, Groq, Together, Ollama…)</option>
        </select>
      </Field>
      <Field
        label="Base URL"
        hint={kind === 'anthropic' ? 'Leave empty for the standard Claude API.' : 'e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1 for Ollama.'}
      >
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
      </Field>
      <Field
        label="API key variable"
        hint="The name of the server .env variable holding the key — not the key itself. e.g. OPENROUTER_API_KEY, or AI_<NAME>_API_KEY. Leave empty for a local model with no key."
      >
        <input value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value.toUpperCase())} className={`${inputClass} font-[family-name:var(--font-mono)]`} />
      </Field>
      <Field label="Default model" hint="Used by bots that don't pick their own model.">
        <input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="e.g. meta-llama/llama-3.3-70b-instruct" className={`${inputClass} font-[family-name:var(--font-mono)]`} />
      </Field>
      <div className="mt-5 border-t border-divider pt-2">
        <h3 className="mt-2 text-sm font-semibold text-foreground">Billing</h3>
        <Field label="Billing mode">
          <select value={billingMode} onChange={(e) => setBillingMode(e.target.value as AiProviderBillingSettings['mode'])} className={inputClass}>
            {Object.entries(BILLING_MODES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Billing key variable (optional)" hint="Use a server variable holding an admin key for Anthropic/OpenAI, or a management key for OpenRouter. Use the same account as this provider. Never paste a key here.">
          <input value={billingKeyEnv} onChange={(e) => setBillingKeyEnv(e.target.value.toUpperCase())} placeholder={kind === 'anthropic' ? 'ANTHROPIC_ADMIN_API_KEY' : 'e.g. OPENROUTER_MANAGEMENT_API_KEY'} className={inputClass} />
        </Field>
        <details className="mt-4" open={hasManual || undefined}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">Record billing figures manually</summary>
          <p className="mt-2 text-[12px] text-foreground-muted">Use figures from your provider’s console when automatic reporting is unavailable. These stay labeled as manual snapshots; automatic figures take priority. Clear both amounts to remove the snapshot.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit balance (USD)">
              <input type="number" step="any" value={manualBalance} onChange={(e) => setManualBalance(e.target.value)} className={inputClass} placeholder="Not recorded" />
            </Field>
            <Field label="Month-to-date spend (USD)">
              <input type="number" min="0" step="any" value={manualSpend} onChange={(e) => setManualSpend(e.target.value)} className={inputClass} placeholder="Not recorded" />
            </Field>
          </div>
          <Field label="Figures as of (UTC)" hint="Spend covers the start of this date’s calendar month through this time. Update the date when recording fresh figures.">
            <input type="datetime-local" value={manualAsOf} onChange={(e) => setManualAsOf(e.target.value)} max={new Date().toISOString().slice(0, 16)} className={inputClass} />
          </Field>
          {!validManual && <p role="alert" className="mt-2 text-[12px] text-red-600">Enter valid USD amounts and a date that is not in the future.</p>}
        </details>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[#0F172B]" />
        Turned on
      </label>
      <div className="mt-5 flex items-center justify-between gap-2">
        <div>
          {provider && !provider.is_default && (
            <button
              onClick={() => { if (confirm(`Delete ${provider.name}? Bots using it switch to the default provider.`)) remove.mutate(); }}
              className="text-[12px] text-red-600 hover:underline"
            >
              Delete provider
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={!name.trim() || !validManual || save.isPending}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
