'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/services/api';

export default function MobileLoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, access_token, refresh_token } = res.data.data;
      if (!user.is_admin) {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }
      setAuth(user, access_token, refresh_token);
      router.push('/m/published-cards');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-sh-lime)] text-sm font-bold text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-ink)]">
          SH
        </span>
        <div>
          <p className="text-lg font-semibold tracking-tight text-[var(--color-sh-ink)]">
            SquadHub
          </p>
          <p className="text-[11px] font-medium text-[var(--color-sh-ink-muted)]">Mobile Admin</p>
        </div>
      </div>

      <div className="sh-card w-full max-w-sm p-6">
        <h1 className="sh-display text-center text-2xl">Sign in</h1>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--color-sh-ink-muted)]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@example.com"
              className="sh-input"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--color-sh-ink-muted)]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="sh-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="sh-btn-primary w-full"
            style={{ padding: '0.875rem 1rem', fontSize: '0.9375rem' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
