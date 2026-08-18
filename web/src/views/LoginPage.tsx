import { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

type PendingReset = {
  user: unknown;
  access_token: string;
  refresh_token: string;
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data: res } = await api.post('/auth/login', { email, password });
      if (res.success) {
        if (res.data.must_reset_password) {
          // Don't commit the session until they pick a real password —
          // same hold-tokens pattern as the self-serve reset flow.
          setPendingReset({
            user: res.data.user,
            access_token: res.data.access_token,
            refresh_token: res.data.refresh_token,
          });
          return;
        }
        setAuth(res.data.user, res.data.access_token, res.data.refresh_token);
        router.push('/');
      }
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
        '/auth/change-password',
        { new_password: newPassword },
        { headers: { Authorization: `Bearer ${pendingReset.access_token}` } },
      );
      setAuth(pendingReset.user as never, pendingReset.access_token, pendingReset.refresh_token);
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not set your new password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#0F172B] text-[10px] font-bold text-white dark:bg-white dark:text-[#0F172B]">
          SH
        </span>
        <div className="flex flex-col leading-tight">
          <p className="font-[family-name:var(--font-display)] text-base font-semibold tracking-tight text-[#0F172B] dark:text-foreground">
            SquadHub
          </p>
          <p className="text-[11px] text-[#62748E] dark:text-foreground-muted">Powered by UpSquad</p>
        </div>
      </div>
      <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-10 shadow-md ring-1 ring-black/5 dark:border-divider dark:bg-surface dark:ring-white/5">
        <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#0F172B] sm:text-2xl dark:text-foreground">
          {pendingReset ? 'Set a new password' : 'Sign in or create an account'}
        </h1>
        <p className="mt-2 text-center text-sm text-[#62748E] dark:text-foreground-muted">
          {pendingReset
            ? 'Your password was reset. Choose one you’ll remember.'
            : 'Enter your details to continue'}
        </p>

        {pendingReset ? (
        <form onSubmit={handleSetPassword} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoFocus
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="Re-enter password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-[#2962FF] text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E4BD8] disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save and sign in'}
          </button>
        </form>
        ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label className="block text-sm font-medium text-[#0F172B] dark:text-foreground">Password</label>
              <Link
                href="/reset-password"
                className="text-xs font-medium text-[#2962FF] hover:underline dark:text-[#5B8BFF]"
              >
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-[#2962FF] text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E4BD8] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Continue'}
          </button>
        </form>
        )}

        <p className="mt-6 text-center text-sm text-[#62748E] dark:text-foreground-muted">
          Don't have an account?{' '}
          <Link href="/signup" className="font-medium text-[#2962FF] hover:underline dark:text-[#5B8BFF]">
            Sign up
          </Link>
        </p>
      </div>
    </>
  );
}
