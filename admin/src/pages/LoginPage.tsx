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
      if (user.role !== 'admin') {
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
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-[#ededed]">SquadHub Admin</h1>
          <p className="mt-1 text-sm text-[#888]">Sign in with your admin account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-[#888]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#ededed]"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#888]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#ededed]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#ededed] py-2 text-sm font-medium text-[#0a0a0a] transition hover:bg-white disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
