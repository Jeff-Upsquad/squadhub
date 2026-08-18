'use client';

import { useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/services/api';

type PendingReset = {
  user: unknown;
  access_token: string;
  refresh_token: string;
};

export default function MobileLoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, access_token, refresh_token, must_reset_password } = res.data.data;
      if (!user.is_admin) {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }
      if (must_reset_password) {
        setPendingReset({ user, access_token, refresh_token });
        return;
      }
      setAuth(user, access_token, refresh_token);
      router.push('/m/subscription-cards');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    if (!pendingReset) return;

    setLoading(true);
    try {
      await axios.post(
        '/api/auth/change-password',
        { new_password: newPassword },
        { headers: { Authorization: `Bearer ${pendingReset.access_token}` } },
      );
      setAuth(pendingReset.user as never, pendingReset.access_token, pendingReset.refresh_token);
      router.push('/m/subscription-cards');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not set your new password. Please try again.');
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
        <h1 className="sh-display text-center text-2xl">{pendingReset ? 'Set a new password' : 'Sign in'}</h1>

        {pendingReset ? (
        <form onSubmit={handleSetPassword} className="mt-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          <p className="text-sm text-[var(--color-sh-ink-muted)]">Your password was reset. Choose one you’ll remember.</p>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--color-sh-ink-muted)]">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
              placeholder="At least 8 characters"
              className="sh-input"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--color-sh-ink-muted)]">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Re-enter password"
              className="sh-input"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="sh-btn-primary w-full"
            style={{ padding: '0.875rem 1rem', fontSize: '0.9375rem' }}
          >
            {loading ? 'Saving…' : 'Save and sign in'}
          </button>
        </form>
        ) : (
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
        )}
      </div>
    </div>
  );
}
