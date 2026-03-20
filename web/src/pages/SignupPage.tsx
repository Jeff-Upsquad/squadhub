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
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#eaeaea] bg-[#fafafa]">
            <svg className="h-6 w-6 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[#171717]">Account Created</h1>
          <p className="mt-3 text-sm text-[#666]">
            Your account is pending admin approval. You'll be able to sign in once an admin reviews your request.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-md bg-[#171717] px-6 py-2 text-sm font-medium text-white transition hover:bg-[#333]"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[#171717]">SquadHub</h1>
          <p className="mt-2 text-sm text-[#666]">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#666]">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#666]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#666]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              placeholder="Min 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#171717] py-2 text-sm font-medium text-white transition hover:bg-[#333] disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#999]">
          Already have an account?{' '}
          <Link to="/login" className="text-[#0070F3] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
