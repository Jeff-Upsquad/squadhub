import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

interface AppConfigRow {
  variant: 'clients' | 'team';
  min_version: string;
  download_url: string | null;
  updated_at: string;
}

export default function SquadChatAppVersionsModule() {
  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-chat-app-config'],
    queryFn: () => api.get('/admin/chat/app-config').then((r) => r.data),
  });
  const configs: AppConfigRow[] = res?.data || [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">App versions</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Force-update gate for Squad Chat apps. Users on versions below <code>min_version</code> see an update-required screen.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-foreground-muted">Loading…</div>
      ) : (
        <div className="space-y-4">
          {configs.map((c) => (
            <ConfigCard key={c.variant} config={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigCard({ config }: { config: AppConfigRow }) {
  const qc = useQueryClient();
  const [minVersion, setMinVersion] = useState(config.min_version);
  const [downloadUrl, setDownloadUrl] = useState(config.download_url || '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMinVersion(config.min_version);
    setDownloadUrl(config.download_url || '');
  }, [config]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/chat/app-config/${config.variant}`, {
        min_version: minVersion,
        download_url: downloadUrl || null,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ['admin-chat-app-config'] });
    },
  });

  const dirty = minVersion !== config.min_version || (downloadUrl || null) !== (config.download_url || null);

  return (
    <div className="rounded-xl border border-divider bg-surface p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold text-foreground">
            {config.variant === 'clients' ? 'Squad Chat (clients app)' : 'Squad Chat Team'}
          </h2>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {config.variant === 'clients'
              ? 'Client & client-staff users download here.'
              : 'Partner, internal, and admin users download here.'}
          </p>
        </div>
        <span className="rounded-full bg-canvas text-foreground-muted px-2 py-0.5 text-[10px] font-medium">
          v{config.min_version}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-foreground-muted mb-1">Min version</label>
          <input
            value={minVersion}
            onChange={(e) => setMinVersion(e.target.value)}
            placeholder="1.0.0"
            className="w-full rounded-md border border-divider px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-foreground-muted mb-1">APK download URL</label>
          <input
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder="https://cdn.example.com/squad-chat-1.0.0.apk"
            className="w-full rounded-md border border-divider px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-foreground-dim">
            Landing page: <code>/squad-chat-{config.variant}</code>
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
