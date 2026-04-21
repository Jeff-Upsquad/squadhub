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
    <div className="rounded-2xl bg-white p-8 shadow-[0_8px_32px_rgba(15,23,43,0.08)] sm:p-10">
      <div className="mb-8 text-center">
        <p className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-tight text-[#2962FF]">SquadHub Admin</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[#0F172B]">
          Admin sign in
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
          className="w-full rounded-md bg-[#2962FF] py-2.5 text-sm font-medium text-white transition hover:bg-[#1E4BD8] disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
