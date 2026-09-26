import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { SquadBotDetail, SquadBotHomeApp, SquadBotStatus } from '@squadhub/shared';
import { HOME_APP_LABELS, StatusChip, StatusSwitch, errorMessage } from './squad-bots/shared';

const inputClass =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none';

export default function AdminSquadBotDetail({ botId, onBack }: { botId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: bot, isLoading } = useQuery<SquadBotDetail>({
    queryKey: ['squad-bot', botId],
    queryFn: () => api.get(`/admin/squad-bots/${botId}`).then((r) => r.data.data),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['squad-bot', botId] });
    qc.invalidateQueries({ queryKey: ['squad-bots'] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/admin/squad-bots/${botId}`, body),
    onSuccess: refresh,
    onError: (e) => alert(errorMessage(e, 'Could not save')),
  });

  if (isLoading || !bot) return <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>;

  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="mb-4 text-[13px] text-foreground-muted hover:text-foreground">← All Squad Bots</button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>🤖</span>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{bot.internal_name}</h1>
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            Customers see it as <span className="font-medium text-foreground">{bot.public_name}</span> · works in {HOME_APP_LABELS[bot.home_app]}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusSwitch value={bot.status} disabled={patch.isPending} onChange={(status: SquadBotStatus) => patch.mutate({ status })} />
          {bot.all_paused && bot.status !== 'off' && (
            <span className="text-[11px] text-red-600">All bots are paused — this bot is running as Off.</span>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <IdentityCard bot={bot} onSave={(body) => patch.mutate(body)} saving={patch.isPending} />
        <AiCard bot={bot} onSave={(body) => patch.mutate(body)} saving={patch.isPending} />
        <TryItCard botId={bot.id} onRan={refresh} />
        <KnowledgeCard bot={bot} />
        <ConnectCard bot={bot} onChanged={refresh} />
        <ActivityCard bot={bot} />
      </div>
    </div>
  );
}

function Card({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-divider bg-surface p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-foreground-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">{children}</span>;
}

function SaveButton({ dirty, saving, onClick }: { dirty: boolean; saving: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!dirty || saving}
      className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-40"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  );
}

function IdentityCard({ bot, onSave, saving }: { bot: SquadBotDetail; onSave: (b: Record<string, unknown>) => void; saving: boolean }) {
  const [internalName, setInternalName] = useState(bot.internal_name);
  const [publicName, setPublicName] = useState(bot.public_name);
  const [description, setDescription] = useState(bot.description);
  const [homeApp, setHomeApp] = useState<SquadBotHomeApp>(bot.home_app);
  useEffect(() => {
    setInternalName(bot.internal_name);
    setPublicName(bot.public_name);
    setDescription(bot.description);
    setHomeApp(bot.home_app);
  }, [bot.internal_name, bot.public_name, bot.description, bot.home_app]);

  const dirty =
    internalName !== bot.internal_name || publicName !== bot.public_name || description !== bot.description || homeApp !== bot.home_app;

  return (
    <Card title="Name and role">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <Label>Internal name</Label>
          <input value={internalName} onChange={(e) => setInternalName(e.target.value)} className={inputClass} />
        </label>
        <label>
          <Label>Name customers see</Label>
          <input value={publicName} onChange={(e) => setPublicName(e.target.value)} className={inputClass} />
        </label>
        <label className="sm:col-span-2">
          <Label>What it does</Label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </label>
        <label>
          <Label>Where it works</Label>
          <select value={homeApp} onChange={(e) => setHomeApp(e.target.value as SquadBotHomeApp)} className={inputClass}>
            {Object.entries(HOME_APP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-foreground-dim">SquadHire bots get their knowledge pushed to SquadHire automatically.</span>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <SaveButton
          dirty={dirty}
          saving={saving}
          onClick={() => onSave({ internal_name: internalName, public_name: publicName, description, home_app: homeApp })}
        />
      </div>
    </Card>
  );
}

function AiCard({ bot, onSave, saving }: { bot: SquadBotDetail; onSave: (b: Record<string, unknown>) => void; saving: boolean }) {
  const [providerId, setProviderId] = useState(bot.provider_id ?? '');
  const [model, setModel] = useState(bot.model ?? '');
  const [maxTokens, setMaxTokens] = useState(String(bot.max_tokens));
  const [instructions, setInstructions] = useState(bot.instructions);
  useEffect(() => {
    setProviderId(bot.provider_id ?? '');
    setModel(bot.model ?? '');
    setMaxTokens(String(bot.max_tokens));
    setInstructions(bot.instructions);
  }, [bot.provider_id, bot.model, bot.max_tokens, bot.instructions]);

  const defaultProvider = bot.providers.find((p) => p.is_default);
  const chosen = bot.providers.find((p) => p.id === providerId) ?? defaultProvider;
  const choosable = bot.providers.filter((p) => p.is_enabled || p.id === bot.provider_id);
  const tokens = Number(maxTokens);
  const tokensValid = Number.isInteger(tokens) && tokens >= 1 && tokens <= 64000;
  const dirty =
    providerId !== (bot.provider_id ?? '') ||
    model !== (bot.model ?? '') ||
    maxTokens !== String(bot.max_tokens) ||
    instructions !== bot.instructions;

  return (
    <Card title="AI" hint="Which AI this bot uses and how it should behave.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          <Label>Provider</Label>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputClass}>
            <option value="">Default{defaultProvider ? ` (${defaultProvider.name})` : ''}</option>
            {choosable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.is_enabled ? ' — off' : !p.ready ? ' — not ready' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Label>Model</Label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={chosen?.default_model ? `${chosen.default_model} (provider default)` : 'e.g. model name'}
            className={`${inputClass} font-[family-name:var(--font-mono)]`}
          />
        </label>
        <label>
          <Label>Max reply length (tokens)</Label>
          <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value.replace(/\D/g, ''))} className={inputClass} />
        </label>
      </div>
      {chosen && !chosen.ready && <p className="mt-2 text-[12px] text-red-600">⚠ {chosen.problem}</p>}
      {bot.ai.problem && !dirty && <p className="mt-2 text-[12px] text-red-600">⚠ {bot.ai.problem}</p>}

      <label className="mt-4 block">
        <Label>Instructions</Label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={10}
          placeholder={`Who the bot is, who it talks to, its tone, what it must never do, and when to hand over to a person.\n\ne.g. You are ${bot.public_name}, the assistant for UpSquad…`}
          className={`${inputClass} font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed`}
        />
        <span className="mt-1 block text-[11px] text-foreground-dim">
          Sent to the AI with every conversation, before any context the bot&apos;s app adds.
        </span>
      </label>
      <div className="mt-4 flex justify-end">
        <SaveButton
          dirty={dirty && tokensValid}
          saving={saving}
          onClick={() => onSave({ provider_id: providerId || null, model: model.trim() || null, max_tokens: tokens, instructions })}
        />
      </div>
    </Card>
  );
}

function TryItCard({ botId, onRan }: { botId: string; onRan: () => void }) {
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<{ text: string; provider: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.post(`/admin/squad-bots/${botId}/test`, { message }).then((r) => r.data.data),
    onSuccess: (data) => {
      setReply(data);
      setError(null);
      onRan();
    },
    onError: (e) => {
      setReply(null);
      setError(errorMessage(e, 'The AI provider failed'));
      onRan();
    },
  });

  return (
    <Card title="Try it" hint="Send a test message using the saved AI settings and instructions. Works while the bot is Off.">
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && message.trim() && !run.isPending) run.mutate(); }}
          placeholder="Type what a customer might ask…"
          className={inputClass}
        />
        <button
          onClick={() => run.mutate()}
          disabled={!message.trim() || run.isPending}
          className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          {run.isPending ? 'Thinking…' : 'Send'}
        </button>
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      {reply && (
        <div className="mt-3 rounded-md bg-canvas px-3 py-2">
          <p className="whitespace-pre-wrap text-[13px] text-foreground">{reply.text || '(empty reply)'}</p>
          <p className="mt-1.5 text-[11px] text-foreground-dim">{reply.provider} · {reply.model}</p>
        </div>
      )}
    </Card>
  );
}

function KnowledgeCard({ bot }: { bot: SquadBotDetail }) {
  const router = useRouter();
  const create = useMutation({
    mutationFn: (title: string) =>
      api.post('/admin/lms/items', { kind: 'post', track: 'knowledge', bot_id: bot.id, title }).then((r) => r.data.data),
    onSuccess: (item) => router.push(`/admin/learning/${item.id}`),
    onError: (e) => alert(errorMessage(e, 'Could not create the knowledge item')),
  });

  return (
    <Card
      title="Knowledge Center"
      hint={
        bot.home_app === 'squadhire'
          ? 'Q&As and guides this bot answers from. Published items go to SquadHire automatically.'
          : "Q&As and guides this bot answers from. Its app reads published items from SquadHub."
      }
      action={
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/admin/learning?track=knowledge&bot=${bot.id}`}
            className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Open in Resources
          </Link>
          <button
            onClick={() => {
              const title = prompt('Question or title for the new knowledge item:');
              if (title?.trim()) create.mutate(title.trim());
            }}
            disabled={create.isPending}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            + Add knowledge
          </button>
        </div>
      }
    >
      {bot.knowledge_items.length === 0 ? (
        <p className="text-[13px] text-foreground-dim">No knowledge yet.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {bot.knowledge_items.slice(0, 12).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/admin/learning/${k.id}`} className="truncate text-[13px] text-foreground hover:underline">{k.title}</Link>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  k.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-foreground-muted'
                }`}
              >
                {k.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      {bot.knowledge_items.length > 12 && (
        <p className="mt-2 text-[12px] text-foreground-muted">+ {bot.knowledge_items.length - 12} more in Resources</p>
      )}
    </Card>
  );
}

function ConnectCard({ bot, onChanged }: { bot: SquadBotDetail; onChanged: () => void }) {
  const [newKey, setNewKey] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () => api.post(`/admin/squad-bots/${bot.id}/api-key`).then((r) => r.data.data),
    onSuccess: (data) => {
      setNewKey(data.api_key);
      onChanged();
    },
    onError: (e) => alert(errorMessage(e, 'Could not create a key')),
  });
  const revoke = useMutation({
    mutationFn: () => api.delete(`/admin/squad-bots/${bot.id}/api-key`),
    onSuccess: () => {
      setNewKey(null);
      onChanged();
    },
  });

  return (
    <Card
      title="Connect the bot's app"
      hint={`${HOME_APP_LABELS[bot.home_app]} uses this key to read the bot's settings and knowledge from SquadHub, and to get AI replies.`}
    >
      {newKey ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-[12px] font-medium text-amber-800">Copy this key now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded bg-surface px-2 py-1.5 font-[family-name:var(--font-mono)] text-[12px] text-foreground">{newKey}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(newKey)}
              className="shrink-0 rounded-md border border-divider bg-surface px-3 text-[12px] text-foreground-muted hover:bg-surface-alt"
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-800">Put it in the app&apos;s server environment (e.g. SQUADHUB_BOT_KEY). Never in browser code.</p>
        </div>
      ) : bot.api_key_prefix ? (
        <p className="text-[13px] text-foreground">
          Connected with key <code className="font-[family-name:var(--font-mono)] text-[12px]">{bot.api_key_prefix}…</code>
          {bot.api_key_created_at && <span className="text-foreground-muted"> · created {new Date(bot.api_key_created_at).toLocaleDateString()}</span>}
        </p>
      ) : (
        <p className="text-[13px] text-amber-700">Not connected yet — create a key and add it to the app.</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => {
            if (!bot.api_key_prefix || confirm('Create a new key? The current key stops working immediately.')) generate.mutate();
          }}
          disabled={generate.isPending}
          className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-alt disabled:opacity-50"
        >
          {bot.api_key_prefix ? 'Replace key' : 'Create key'}
        </button>
        {bot.api_key_prefix && (
          <button
            onClick={() => { if (confirm('Disconnect the app? Its key stops working immediately.')) revoke.mutate(); }}
            className="text-[12px] text-red-600 hover:underline"
          >
            Disconnect
          </button>
        )}
      </div>
      <details className="mt-4 text-[12px] text-foreground-muted">
        <summary className="cursor-pointer select-none">For developers: API</summary>
        <div className="mt-2 space-y-1 font-[family-name:var(--font-mono)] text-[11.5px]">
          <p>Base: https://api.squadhub.in · Header: Authorization: Bearer &lt;key&gt;</p>
          <p>GET  /integrations/squad-bots/config — status, names, AI, instructions</p>
          <p>GET  /integrations/squad-bots/knowledge — published knowledge</p>
          <p>POST /integrations/squad-bots/reply — {'{ messages: [{role, content}], context? }'}</p>
        </div>
        <p className="mt-2">
          Status tells the app what to do: <b>off</b> — nothing (reply returns 423); <b>practice</b> — log the reply, don&apos;t send;
          <b> approval</b> — hold for a person; <b>live</b> — send.
        </p>
      </details>
    </Card>
  );
}

function ActivityCard({ bot }: { bot: SquadBotDetail }) {
  return (
    <Card title="Recent activity" hint="The latest AI calls made through SquadHub.">
      {bot.recent_runs.length === 0 ? (
        <p className="text-[13px] text-foreground-dim">Nothing yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-foreground-dim">
                <th className="py-1.5 pr-3 font-medium">When</th>
                <th className="py-1.5 pr-3 font-medium">From</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">AI</th>
                <th className="py-1.5 pr-3 font-medium">Tokens in / out</th>
                <th className="py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {bot.recent_runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 text-foreground-muted">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-foreground-muted">{r.source === 'admin_test' ? 'Try it' : 'App'}</td>
                  <td className="py-1.5 pr-3"><StatusChip status={r.bot_status} /></td>
                  <td className="py-1.5 pr-3 text-foreground-muted">{r.provider_slug ? `${r.provider_slug} · ${r.model}` : '—'}</td>
                  <td className="py-1.5 pr-3 text-foreground-muted">{r.input_tokens ?? '—'} / {r.output_tokens ?? '—'}</td>
                  <td className="py-1.5">
                    {r.ok ? <span className="text-emerald-700">OK</span> : <span className="text-red-600" title={r.error ?? ''}>Failed{r.error ? `: ${r.error.slice(0, 60)}` : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
