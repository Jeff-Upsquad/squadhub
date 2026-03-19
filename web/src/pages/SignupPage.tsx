import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function SignupPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
        setSubmitted(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Success state — awaiting admin approval
  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#222] bg-[#111]">
            <svg className="h-6 w-6 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#ededed]">Account Created</h1>
          <p className="mt-3 text-sm text-[#888]">
            Your account is pending admin approval. You'll be able to sign in once an admin reviews your request.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-md bg-[#ededed] px-6 py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[#ededed]">SquadHub</h1>
          <p className="mt-2 text-sm text-[#888]">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#888]">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none transition focus:border-[#ededed]"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#888]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none transition focus:border-[#ededed]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#888]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none transition focus:border-[#ededed]"
              placeholder="Min 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#ededed] py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#555]">
          Already have an account?{' '}
          <Link to="/login" className="text-[#ededed] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
