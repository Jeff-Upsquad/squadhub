'use client';

import { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

/**
 * Self-serve password reset, keyed on the phone number registered on the
 * account. Mirrors the flow SquadHire business users already know:
 *
 *   phone → confirm it's your account → temp password over WhatsApp → new password
 *
 * The temp password is never shown in the browser; it only arrives on WhatsApp.
 *
 * Note the session handling: verifying the temp password already returns a
 * valid session, but committing it to the auth store would let the (auth)
 * layout redirect the user into the app with a temporary credential still
 * active. So the tokens are held in local state and only written to the store
 * once the new password is actually set.
 */

type Step = 'phone' | 'confirm' | 'code' | 'newpass';

const inputCls =
  'h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-2 focus:ring-[#2962FF]/20 dark:border-divider dark:bg-surface-alt dark:text-foreground dark:placeholder-foreground-dim';
const labelCls = 'mb-1.5 block text-sm font-medium text-[#0F172B] dark:text-foreground';
const buttonCls =
  'h-11 w-full rounded-lg bg-[#2962FF] text-sm font-semibold text-white shadow-sm transition hover:bg-[#1E4BD8] disabled:opacity-50';

export default function ResetPasswordPage() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [maskedName, setMaskedName] = useState('');
  const [ticket, setTicket] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<{ access: string; refresh: string; user: unknown } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const fail = (err: unknown, fallback: string) => {
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
    setError(msg);
  };

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/password-reset/lookup', { phone });
      if (res.data?.found) {
        setMaskedName(res.data.masked_name || '');
        setTicket(res.data.reset_ticket);
        setStep('confirm');
      } else {
        setError(
          "We couldn't find an active account with that number. Check the number, or contact your Squad manager.",
        );
      }
    } catch (err) {
      fail(err, 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/password-reset/send', { reset_ticket: ticket });
      setDelivered(res.data?.delivered ?? false);
      setStep('code');
    } catch (err) {
      fail(err, 'Could not send the temporary password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: res } = await api.post('/auth/password-reset/verify', {
        reset_ticket: ticket,
        temp_password: tempPassword,
      });
      setTokens({
        access: res.data.access_token,
        refresh: res.data.refresh_token,
        user: res.data.user,
      });
      setStep('newpass');
    } catch (err) {
      fail(err, 'Incorrect temporary password.');
    } finally {
      setLoading(false);
    }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    if (!tokens) return;

    setLoading(true);
    try {
      // Bare axios with the freshly-minted token: the shared client reads from
      // the auth store, which we deliberately haven't populated yet.
      await axios.post(
        '/auth/change-password',
        { new_password: newPassword },
        { headers: { Authorization: `Bearer ${tokens.access}` } },
      );
      setAuth(tokens.user as never, tokens.access, tokens.refresh);
      router.push('/');
    } catch (err) {
      fail(err, 'Could not set your new password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          {step === 'newpass' ? 'Set a new password' : 'Reset your password'}
        </h1>
        <p className="mt-2 text-center text-sm text-[#62748E] dark:text-foreground-muted">
          {step === 'phone' && 'Enter the phone number registered on your account'}
          {step === 'confirm' && 'Confirm this is your account'}
          {step === 'code' && 'Enter the temporary password we sent you'}
          {step === 'newpass' && 'Choose a password you’ll remember'}
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {step === 'phone' && (
          <form onSubmit={submitPhone} className="mt-6 space-y-4">
            <div>
              <label className={labelCls}>Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
                className={inputCls}
                placeholder="+91 98765 43210"
              />
            </div>
            <button type="submit" disabled={loading} className={buttonCls}>
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'confirm' && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-center dark:border-divider dark:bg-surface-alt">
              <p className="text-sm text-[#62748E] dark:text-foreground-muted">Account found</p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-[#0F172B] dark:text-foreground">
                {maskedName || '••••'}
              </p>
            </div>
            <p className="text-sm text-[#62748E] dark:text-foreground-muted">
              We&rsquo;ll send a temporary password to this number on WhatsApp.
            </p>
            <button type="button" onClick={sendCode} disabled={loading} className={buttonCls}>
              {loading ? 'Sending…' : 'Send temporary password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setError('');
              }}
              className="h-11 w-full rounded-lg border border-[#E2E8F0] text-sm font-medium text-[#0F172B] transition hover:bg-[#F8FAFC] dark:border-divider dark:text-foreground dark:hover:bg-surface-alt"
            >
              Use a different number
            </button>
          </div>
        )}

        {step === 'code' && (
          <form onSubmit={submitCode} className="mt-6 space-y-4">
            {delivered === false && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                We couldn&rsquo;t confirm WhatsApp delivery. If nothing arrives in a minute, please
                contact your Squad manager.
              </div>
            )}
            <div>
              <label className={labelCls}>Temporary password</label>
              <input
                type="text"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={inputCls}
                placeholder="word-word"
              />
              <p className="mt-1.5 text-xs text-[#62748E] dark:text-foreground-muted">
                Two words joined by a hyphen, sent to you on WhatsApp.
              </p>
            </div>
            <button type="submit" disabled={loading} className={buttonCls}>
              {loading ? 'Verifying…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'newpass' && (
          <form onSubmit={submitNewPassword} className="mt-6 space-y-4">
            <div>
              <label className={labelCls}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
                className={inputCls}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className={labelCls}>Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className={inputCls}
                placeholder="Re-enter password"
              />
            </div>
            <button type="submit" disabled={loading} className={buttonCls}>
              {loading ? 'Saving…' : 'Save and sign in'}
            </button>
          </form>
        )}

        {step !== 'newpass' && (
          <p className="mt-6 text-center text-sm text-[#62748E] dark:text-foreground-muted">
            Remembered it?{' '}
            <Link
              href="/login"
              className="font-medium text-[#2962FF] hover:underline dark:text-[#5B8BFF]"
            >
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </>
  );
}
