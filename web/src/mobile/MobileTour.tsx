'use client';

/**
 * First-run tour for the phone shell.
 *
 * The web's admin-driven Feature Tips are written against desktop anchors (the
 * icon rail, the module sidebar, the tab strip) — none of which exist here, so
 * they're suppressed on mobile and this runs instead. It's a fixed, local tour:
 * four coachmarks introducing the bottom bar, the Home the user actually got
 * (spaces for clients, the briefing for partners), creating a task, and chat.
 *
 * It shows once per user per device (localStorage) and only on the Home tab,
 * where all four anchors are on screen.
 */

import { useEffect, useLayoutEffect, useState } from 'react';

/** Breathing room between the anchor and the spotlight edge. */
const pad = 8;
import { createPortal } from 'react-dom';

type Step = {
  /** `data-tour` value of the element to spotlight. */
  anchor: string;
  title: string;
  body: string;
  bullets?: [string, string][];
};

type Audience = 'client' | 'partner';

/**
 * Two scripts, because the two Homes answer different questions. Clients are
 * introduced to their spaces; partners and internal staff to their briefing.
 * Steps 1 and 4 differ only in wording — same anchors, same shape.
 */
const STEPS: Record<Audience, Step[]> = {
  client: [
    {
      anchor: 'tabbar',
      title: 'Start with the four tabs',
      body: 'Everything on your phone lives behind one of these:',
      bullets: [
        ['Home', 'your spaces — where the work is'],
        ['Chat', 'conversations with your team and talent'],
        ['Inbox', 'what needs your attention; the red dot is unread'],
        ['More', 'tasks, calendar, resources and your account'],
      ],
    },
    {
      anchor: 'spaces',
      title: 'These are your spaces',
      body:
        'A space is one stream of work your team shares with SquadHub — a Design Space, a Video Space, and so on. Everything for that service lives inside it: the task list, the files, the people working on it.\n\nTap a space to see its tasks. Tap the arrow on a task to open it.',
    },
    {
      anchor: 'fab',
      title: 'Ask for something new',
      body:
        "This button creates a task — that's how you brief the team.\n\nGive it a name, pick which space it belongs to, and add a due date if it matters. Tap Create and the talent on that space sees it straight away.\n\nThe small + on a space card does the same thing, already pointed at that space.",
    },
    {
      anchor: 'chat-tab',
      title: 'Talk to your talent',
      body:
        "Open Chat and look under Direct messages for your Squad Manager or client staff on the same space — that's a private thread with just them. Channels are shared with the wider team, and Support reaches SquadHub itself.\n\nNo one to message yet? Tap New message and search for them.",
    },
  ],
  partner: [
    {
      anchor: 'tabbar',
      title: 'Start with the four tabs',
      body: 'Everything on your phone lives behind one of these:',
      bullets: [
        ['Home', "today's briefing and your workspace"],
        ['Chat', 'channels and direct messages'],
        ['Inbox', 'what needs your attention; the red dot is unread'],
        ['More', 'my tasks, day planner, calendar, apps and your account'],
      ],
    },
    {
      anchor: 'briefing',
      title: "Your day, up top",
      body:
        "The big tile is what's scheduled for today, with Overdue and New beside it — New is work assigned to you that you haven't looked at yet.\n\nTap any tile to open My Tasks. Below them, My Home, Meetings and Check-in are one tap away.",
    },
    {
      anchor: 'fab',
      title: 'Create a task',
      body:
        "Give it a name, choose the list it belongs in, then set assignee, priority and dates from the chips.\n\nOpen a space or list first and the + is already pointed at it, so you can skip the picker.",
    },
    {
      anchor: 'chat-tab',
      title: 'Channels and DMs',
      body:
        'Chat holds the channels you belong to and your direct messages.\n\nChannels linked to a space or list are shared with everyone on that work. A DM is a private thread with partners and Squad Managers on the same work. Tap New message to start one, and Support reaches the SquadHub team.',
    },
  ],
};

const STORAGE_PREFIX = 'squadhub.mobile-tour.v1';

function seenKey(userId: string | undefined) {
  return `${STORAGE_PREFIX}:${userId ?? 'anon'}`;
}

export function hasSeenMobileTour(userId: string | undefined): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(seenKey(userId)) === 'done';
  } catch {
    return true; // Storage blocked — don't nag on every load.
  }
}

export default function MobileTour({
  userId,
  audience,
  onDone,
}: {
  userId: string | undefined;
  audience: Audience;
  onDone: () => void;
}) {
  const steps = STEPS[audience];
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Borrowed from the anchor so the ring hugs a circular FAB as tightly as it
  // hugs a rectangular bar.
  const [radius, setRadius] = useState('14px');
  const step = steps[i];

  // Track the anchor's box: it moves as the tour advances, and again if the
  // sheet scrolls or the viewport resizes (address bar collapsing, rotation).
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
      if (el) {
        const r = getComputedStyle(el).borderRadius;
        setRadius(r && r !== '0px' ? `calc(${r} + ${pad}px)` : '14px');
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [step.anchor]);

  const finish = () => {
    try {
      window.localStorage.setItem(seenKey(userId), 'done');
    } catch {
      /* storage blocked — the tour just runs again next time */
    }
    onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const last = i === steps.length - 1;
  const hole = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // Place the card on whichever side of the spotlight has more room.
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const above = !!hole && hole.top > vh - (hole.top + hole.height);

  const card = (
    <div
      className="mtour-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mtour-title"
      style={
        hole
          ? above
            ? { bottom: vh - hole.top + 12 }
            : { top: hole.top + hole.height + 12 }
          : { top: '50%', transform: 'translateY(-50%)' }
      }
    >
      <span className="mtour-badge">Quick tour · {i + 1} of {steps.length}</span>
      <h2 id="mtour-title">{step.title}</h2>
      <p>{step.body}</p>
      {step.bullets && (
        <ul className="mtour-list">
          {step.bullets.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mtour-actions">
        {!last && (
          <button type="button" className="mtour-skip" onClick={finish}>
            Skip
          </button>
        )}
        {i > 0 && (
          <button type="button" className="mtour-back" onClick={() => setI(i - 1)}>
            Back
          </button>
        )}
        <button
          type="button"
          className="mtour-next"
          onClick={() => (last ? finish() : setI(i + 1))}
        >
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  );

  const overlay = (
    <div className="mtour">
      {/* Blocks taps on the app behind — the tour is explanatory, so nothing
          under it should be clickable, spotlight included. */}
      <div className="mtour-block" />
      {hole ? (
        /* The dim is an enormous spread shadow cast *outward* from the hole,
           so the cut-out takes the anchor's own shape — a circle around the
           FAB, a rounded rect around the tab bar. Four dim panes couldn't. */
        <div
          className="mtour-spot"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: radius,
          }}
        />
      ) : (
        <div className="mtour-spot mtour-spot--full" />
      )}
      {card}
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(overlay, document.body);
}
