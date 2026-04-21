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
      <p className="font-[family-name:var(--font-display)] text-sm font-medium tracking-tight text-[#62748E]">
        SquadHub Admin
      </p>
      <div className="w-full rounded-2xl border border-[#E2E8F0] bg-white px-8 py-10 shadow-md ring-1 ring-black/5">
        <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[#0F172B] sm:text-2xl">
          Admin sign in
        </h1>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-md bg-[#2962FF] text-sm font-medium text-white transition hover:bg-[#1E4BD8] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </>
  );
}
