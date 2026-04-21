import { useState } from 'react';
import Link from 'next/link';
import api from '../services/api';

export default function SignupPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [wasInvited, setWasInvited] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
        <p className="font-[family-name:var(--font-display)] text-sm font-medium tracking-tight text-[#62748E]">
          SquadHub
        </p>
        <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-10 text-center shadow-md ring-1 ring-black/5">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F1F5F9]">
            <svg className="h-6 w-6 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#0F172B] sm:text-2xl">
            {wasInvited ? 'Welcome Aboard!' : 'Account Created'}
          </h1>
          <p className="mt-3 text-sm text-[#62748E]">
            {wasInvited
              ? 'Your signup has been approved! You can now proceed to the login page.'
              : "Your account is pending admin approval. You'll be able to sign in once an admin reviews your request."}
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#2962FF] px-6 text-sm font-medium text-white transition hover:bg-[#1E4BD8]"
          >
            {wasInvited ? 'Go to Sign In' : 'Back to Sign In'}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="font-[family-name:var(--font-display)] text-sm font-medium tracking-tight text-[#62748E]">
        SquadHub
      </p>
      <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-10 shadow-md ring-1 ring-black/5">
        <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#0F172B] sm:text-2xl">
          Create your account
        </h1>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder="Min 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-md bg-[#2962FF] text-sm font-medium text-white transition hover:bg-[#1E4BD8] disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#90A1B9]">
          Already have an account?{' '}
          <Link href="/login" className="text-[#2962FF] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
