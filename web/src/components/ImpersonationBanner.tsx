import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * Visible for the whole of a super-admin "Log in as" session: the server ties
 * the Supabase session minted by the one-time link to the impersonation
 * (login_tokens.session_id), so this survives reloads and token refreshes.
 */
export default function ImpersonationBanner() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { data } = useQuery({
    queryKey: ['auth', 'impersonation', user?.id],
    queryFn: () =>
      api.get('/auth/impersonation').then(
        (r) => r.data.data as { active: boolean; actor_email?: string | null; reason?: string | null },
      ),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!data?.active) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-3 bg-red-600 px-3 py-1.5 text-[12.5px] font-medium text-white shadow"
    >
      <span className="truncate">
        Support session: {data.actor_email || 'Squad Hub staff'} is signed in as {user?.display_name || user?.email}
        {data.reason ? ` — “${data.reason}”` : ''}
      </span>
      <button
        onClick={() => {
          logout();
          window.location.href = '/login';
        }}
        className="shrink-0 rounded-md border border-white/60 px-2 py-0.5 text-[11.5px] font-semibold hover:bg-white/15"
      >
        End session
      </button>
    </div>
  );
}
