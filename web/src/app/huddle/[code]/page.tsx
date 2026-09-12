'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import { Room } from 'livekit-client';
import type { HuddleJoinCredentials } from '@squadhub/shared';
import { useAuthStore } from '../../../stores/authStore';
import api from '../../../services/api';
import HuddleCall from '../../../views/app/huddles/HuddleCall';
import '../../../views/app/huddles/huddle.css';

// Public share-link landing: /huddle/<code>. Anyone with the link can join
// as a guest (name only) when the huddle allows it; a signed-in SquadHub
// member on the same browser joins under their own name via the member path.
// Standalone — no MainLayout, no sockets — the call surface is the same
// HuddleCall the in-app dock uses.

interface PublicHuddle {
  id: string;
  code: string;
  topic: string | null;
  started_at: string;
  ended_at: string | null;
  allow_guests: boolean;
  starter_name: string | null;
  participant_count: number;
  participants: { display_name: string; avatar_url: string | null }[];
}

type Phase = 'loading' | 'landing' | 'joining' | 'in-call' | 'left' | 'error';

export default function HuddleGuestPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code as string;
  const [info, setInfo] = useState<PublicHuddle | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creds, setCreds] = useState<HuddleJoinCredentials | null>(null);
  const roomRef = useRef<Room | null>(null);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!code) return;
    axios
      .get(`/huddles/public/${code}`)
      .then((r) => {
        setInfo(r.data.data);
        setPhase('landing');
      })
      .catch((e) => {
        setError(e?.response?.status === 404 ? 'This huddle link is not valid.' : 'Could not load the huddle.');
        setPhase('error');
      });
  }, [code]);

  useEffect(() => {
    if (user?.display_name && !name) setName(user.display_name);
  }, [user?.display_name, name]);

  // Tell the server we're gone even if the tab just closes (guests carry no
  // auth, so a beacon is enough).
  useEffect(() => {
    if (phase !== 'in-call' || !creds || !creds.identity.startsWith('guest:')) return;
    const onUnload = () => {
      try {
        navigator.sendBeacon(
          `/huddles/public/${code}/leave`,
          new Blob([JSON.stringify({ identity: creds.identity })], { type: 'application/json' }),
        );
      } catch {
        /* best effort */
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [phase, creds, code]);

  const join = useCallback(async () => {
    if (!info) return;
    setPhase('joining');
    setError(null);
    try {
      let c: HuddleJoinCredentials | null = null;
      // Signed-in member? Try the member path first; fall back to guest if
      // they're not in this conversation.
      if (accessToken) {
        try {
          c = (await api.post(`/huddles/${info.id}/join`)).data.data;
        } catch {
          c = null;
        }
      }
      if (!c) {
        if (!info.allow_guests) throw new Error('Guests are not allowed in this huddle. Ask for an invite.');
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Please enter your name.');
        c = (await axios.post(`/huddles/public/${code}/join`, { name: trimmed })).data.data;
      }
      if (!c) throw new Error('Could not join.');
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on('disconnected', () => {
        if (roomRef.current === room) {
          roomRef.current = null;
          setPhase('left');
        }
      });
      await room.connect(c.url, c.token);
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      roomRef.current = room;
      setCreds(c);
      setPhase('in-call');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not join the huddle.');
      setPhase('landing');
    }
  }, [info, accessToken, name, code]);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    try {
      await room?.disconnect();
    } finally {
      if (creds?.identity.startsWith('guest:')) {
        await axios.post(`/huddles/public/${code}/leave`, { identity: creds.identity }).catch(() => undefined);
      } else if (creds) {
        await api.post(`/huddles/${creds.huddle.huddle.id}/leave`).catch(() => undefined);
      }
      setPhase('left');
    }
  }, [creds, code]);

  if (phase === 'in-call' && roomRef.current && creds) {
    return (
      <div className="fixed inset-0">
        <HuddleCall
          room={roomRef.current}
          title={info?.topic || 'SquadHub huddle'}
          subtitle={info?.starter_name ? `Started by ${info.starter_name}` : null}
          shareUrl={typeof window !== 'undefined' ? window.location.href : null}
          onLeave={leave}
        />
      </div>
    );
  }

  const ended = !!info?.ended_at;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#141518] px-4 text-[#f5f5f7]">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1d1e23] p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0a7d55] text-lg" aria-hidden>🎧</span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{info?.topic || 'SquadHub huddle'}</div>
            <div className="truncate text-[12px] text-white/60">
              {phase === 'loading' && 'Loading…'}
              {phase !== 'loading' && info?.starter_name && `Started by ${info.starter_name}`}
            </div>
          </div>
        </div>

        {phase === 'error' && <p className="text-[13px] text-red-300">{error}</p>}

        {phase === 'left' && (
          <>
            <p className="text-[13px] text-white/80">You left the huddle.</p>
            <button type="button" className="mt-4 w-full rounded-lg bg-white/10 py-2 text-[13px] font-medium hover:bg-white/15" onClick={() => setPhase('landing')}>
              Rejoin
            </button>
          </>
        )}

        {(phase === 'landing' || phase === 'joining') && info && (
          <>
            {ended ? (
              <p className="text-[13px] text-white/80">This huddle has ended.</p>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2 text-[12.5px] text-white/70">
                  <span className="flex">
                    {info.participants.slice(0, 5).map((p, i) => (
                      <span
                        key={i}
                        className="-ml-1.5 grid h-6 w-6 place-items-center overflow-hidden rounded-[7px] border-2 border-[#1d1e23] bg-[#0a7d55] text-[10px] font-bold first:ml-0"
                        title={p.display_name}
                      >
                        {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" /> : p.display_name[0]?.toUpperCase()}
                      </span>
                    ))}
                  </span>
                  <span>{info.participant_count ? `${info.participant_count} in the huddle` : 'Nobody in yet'}</span>
                </div>
                {!accessToken && (
                  <label className="block">
                    <span className="mb-1 block text-[12px] text-white/60">Your name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && join()}
                      maxLength={40}
                      autoFocus
                      placeholder="e.g. Priya from Acme"
                      className="w-full rounded-lg border border-white/10 bg-[#141518] px-3 py-2 text-[14px] text-white outline-none placeholder:text-white/30 focus:border-[#0a7d55]"
                    />
                  </label>
                )}
                {accessToken && <p className="text-[12.5px] text-white/60">Joining as <span className="text-white">{user?.display_name}</span></p>}
                {error && <p className="mt-2 text-[12.5px] text-red-300">{error}</p>}
                <button
                  type="button"
                  onClick={join}
                  disabled={phase === 'joining'}
                  className="mt-4 w-full rounded-lg bg-[#0a7d55] py-2.5 text-[14px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {phase === 'joining' ? 'Joining…' : 'Join huddle'}
                </button>
                <p className="mt-3 text-center text-[11px] text-white/40">Your browser will ask for microphone access.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
