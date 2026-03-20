import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data: res } = await api.post('/auth/login', { email, password });
      if (res.success) {
        setAuth(res.data.user, res.data.access_token, res.data.refresh_token);
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[#171717]">SquadHub</h1>
          <p className="mt-2 text-sm text-[#666]">Sign in to your workspace</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

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
              className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#171717] py-2 text-sm font-medium text-white transition hover:bg-[#333] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Continue'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#999]">
          Don't have an account?{' '}
          <Link to="/signup" className="text-[#0070F3] hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
