import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, access_token, refresh_token } = res.data.data;

      // Only allow admin users into the admin panel
      if (!user.is_admin) {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }

      setAuth(user, access_token, refresh_token);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-ink text-[10px] font-bold text-white">SH</span>
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-2">
            <p className="font-[family-name:var(--font-display)] text-sm font-medium tracking-tight text-foreground">SquadHub</p>
            <span className="font-[family-name:var(--font-mono)] rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">Admin</span>
          </div>
          <p className="text-[11px] text-foreground-muted">Powered by UpSquad</p>
        </div>
      </div>
      <div className="w-full rounded-2xl border border-divider bg-surface px-8 py-10 shadow-md ring-1 ring-black/5">
        <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Admin sign in
        </h1>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</p>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-md bg-accent text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </>
  );
}
