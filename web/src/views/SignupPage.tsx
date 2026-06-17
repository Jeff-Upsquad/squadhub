import { useState } from 'react';
import Link from 'next/link';
import api from '../services/api';

export default function SignupPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [wasInvited, setWasInvited] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const { data: res } = await api.post('/auth/register', {
        email,
        password,
        display_name: displayName,
      });
      if (res.success) {
        setWasInvited(!!res.invited);
        setSubmitted(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (submitted) {
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
        <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-10 text-center shadow-md ring-1 ring-black/5 dark:border-divider dark:bg-surface dark:ring-white/5">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F1F5F9] dark:border-divider dark:bg-surface-alt">
            <svg className="h-6 w-6 text-[#007A5A] dark:text-[#34D399]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#0F172B] sm:text-2xl dark:text-foreground">
            {wasInvited ? 'Welcome Aboard!' : 'Account Created'}
          </h1>
          <p className="mt-2 text-sm text-[#62748E] dark:text-foreground-muted">
            {wasInvited
              ? 'Your signup has been approved! You can now proceed to the login page.'
              : "Your account is pending admin approval. You'll be able to sign in once an admin reviews your request."}
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-[#2962FF] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E4BD8]"
          >
            {wasInvited ? 'Go to Sign In' : 'Back to Sign In'}
          </Link>
        </div>
      </>
    );
  }

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
          Create your account
        </h1>
        <p className="mt-2 text-center text-sm text-[#62748E] dark:text-foreground-muted">
          Start your SquadHub account in seconds
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="Jane Doe"
            />
          </div>

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
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="Min 8 characters"
            />
            <p className="mt-1.5 text-xs text-[#62748E] dark:text-foreground-muted">
              First-time users: create your own password here — you&apos;ll use it to sign in.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim"
              placeholder="Re-enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-[#2962FF] text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E4BD8] disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#62748E] dark:text-foreground-muted">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[#2962FF] hover:underline dark:text-[#5B8BFF]">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
