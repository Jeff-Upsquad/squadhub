import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

export default function SignupPage() {
  const [displayName, setDisplayName] = useState('');
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
      const { data: res } = await api.post('/auth/register', {
        email,
        password,
        display_name: displayName,
      });
      if (res.success) {
        setAuth(res.data.user, res.data.access_token, res.data.refresh_token);
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

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
