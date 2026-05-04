'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/services/api';

export default function MobileLoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, access_token, refresh_token } = res.data.data;
      if (!user.is_admin) {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }
      setAuth(user, access_token, refresh_token);
      router.push('/m/published-cards');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 border-black bg-[#d4ff4d] text-sm font-bold text-black shadow-[3px_3px_0_0_#000]">
          SH
        </span>
        <div>
          <p className="font-[family-name:var(--font-jakarta)] text-lg font-bold tracking-tight text-[#0a0a0a]">
            SquadHub
          </p>
          <p className="text-[11px] font-medium text-[#525252]">Mobile Admin</p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border-2 border-black bg-white p-6 shadow-[4px_4px_0_0_#000]">
        <h1 className="text-center font-[family-name:var(--font-jakarta)] text-xl font-bold tracking-tight text-[#0a0a0a]">
          Sign in
        </h1>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div className="rounded-xl border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#525252]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@example.com"
              className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-base text-[#0a0a0a] placeholder-[#a3a3a3] outline-none transition-shadow focus:shadow-[3px_3px_0_0_#000]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#525252]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-base text-[#0a0a0a] placeholder-[#a3a3a3] outline-none transition-shadow focus:shadow-[3px_3px_0_0_#000]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl border-2 border-black bg-[#d4ff4d] px-6 py-3.5 text-base font-bold text-black shadow-[3px_3px_0_0_#000] transition-transform active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
