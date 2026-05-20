import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../stores/authStore';
import api from '../../../services/api';

export default function PartnerDashboard() {
  const user = useAuthStore((s) => s.user);

  const { data: assignmentsRes } = useQuery({
    queryKey: ['my-client-assignments'],
    queryFn: () => api.get('/users/me/client-links').then((r) => r.data),
  });

  const assignments = assignmentsRes?.data || [];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Welcome, {user?.display_name}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">Partner Portal</p>

        {/* Assigned clients */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Assigned Clients</h2>
          {assignments.length === 0 ? (
            <div className="mt-4 rounded-lg border border-divider bg-surface-alt p-6 text-center">
              <p className="text-sm text-foreground-muted">No clients assigned yet. An administrator will assign you to clients.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {assignments.map((a: any) => (
                <div key={a.id} className="rounded-lg border border-divider bg-surface-alt p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-foreground">{a.client?.business_name || 'Client'}</h3>
                      {a.role && (
                        <span className="mt-1 inline-block rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-400">
                          {a.role}
                        </span>
                      )}
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-divider bg-surface-alt p-4 text-center">
              <svg className="mx-auto h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="mt-2 text-sm font-medium text-foreground">Tasks</p>
              <p className="text-xs text-foreground-muted">View assigned work</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-4 text-center">
              <svg className="mx-auto h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              <p className="mt-2 text-sm font-medium text-foreground">Messages</p>
              <p className="text-xs text-foreground-muted">Chat with the team</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-4 text-center">
              <svg className="mx-auto h-8 w-8 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <p className="mt-2 text-sm font-medium text-foreground">Spaces</p>
              <p className="text-xs text-foreground-muted">Project workspaces</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
