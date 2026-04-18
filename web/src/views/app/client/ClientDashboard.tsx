import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../stores/authStore';
import { usePMStore } from '../../../stores/pmStore';
import api from '../../../services/api';

interface DesignFolder {
  id: string;
  name: string;
  space_id: string;
  space?: { id: string; name: string };
  created_at: string;
}

export default function ClientDashboard() {
  const user = useAuthStore((s) => s.user);
  const setActiveDesignFolder = usePMStore((s) => s.setActiveDesignFolder);

  const { data: assignmentsRes } = useQuery({
    queryKey: ['my-client-assignments'],
    queryFn: () => api.get('/users/me/client-links').then((r) => r.data),
  });

  const { data: designFoldersRes } = useQuery({
    queryKey: ['my-design-folders'],
    queryFn: () => api.get('/users/me/design-folders').then((r) => r.data),
  });

  const assignments = assignmentsRes?.data || [];
  const designFolders: DesignFolder[] = designFoldersRes?.data || [];

  const openDesignFolder = (folderId: string) => {
    setActiveDesignFolder(folderId);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Welcome, {user?.display_name}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">Client Portal</p>

        {/* Design workspace */}
        {designFolders.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
              Your design workspace
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {designFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openDesignFolder(f.id)}
                  className="group flex items-start gap-3 rounded-lg border border-divider bg-surface-alt p-4 text-left transition hover:border-foreground/20 hover:bg-surface-alt/80"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-foreground text-surface">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium text-foreground">{f.name}</h3>
                    <p className="truncate text-xs text-foreground-muted">
                      {f.space?.name || 'Design workspace'}
                    </p>
                    <p className="mt-2 text-xs text-foreground-muted opacity-0 transition group-hover:opacity-100">
                      Open dashboard →
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Linked business info */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Your Business</h2>
          {assignments.length === 0 ? (
            <div className="mt-4 rounded-lg border border-divider bg-surface-alt p-6 text-center">
              <p className="text-sm text-foreground-muted">No business account linked yet. Your account administrator will set this up.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {assignments.map((a: any) => (
                <div key={a.id} className="rounded-lg border border-divider bg-surface-alt p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-foreground">{a.client?.business_name || 'Business'}</h3>
                      {a.role && <p className="text-xs text-foreground-muted">{a.role}</p>}
                    </div>
                    <span className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
                      Active
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Quick Actions</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-divider bg-surface-alt p-4 text-center">
              <svg className="mx-auto h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="mt-2 text-sm font-medium text-foreground">Messages</p>
              <p className="text-xs text-foreground-muted">Chat with the team</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-4 text-center">
              <svg className="mx-auto h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mt-2 text-sm font-medium text-foreground">Documents</p>
              <p className="text-xs text-foreground-muted">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
