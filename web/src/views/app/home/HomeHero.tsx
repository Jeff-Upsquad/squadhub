import { useMemo } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { getDailyQuote } from '../../../lib/dailyQuote';

/**
 * Shared hero for every role home: date eyebrow, display greeting with a
 * muted full-stop, daily quote. Role flavour comes in via props —
 * `greetingPrefix` overrides the time-of-day greeting, `roleLabel` keeps
 * the small which-home-am-I tag aligned right on the eyebrow line.
 */
export default function HomeHero({ roleLabel, greetingPrefix }: { roleLabel: string; greetingPrefix?: string }) {
  const user = useAuthStore((s) => s.user);

  const { eyebrow, firstName } = useMemo(() => {
    const now = new Date();
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dt = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const start = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const name = (user?.display_name || user?.email || 'there').split(/[@ ]/)[0];
    return {
      eyebrow: `${day}, ${dt} · Week ${weekNum} · Q${quarter}`,
      firstName: name.charAt(0).toUpperCase() + name.slice(1),
    };
  }, [user]);

  const greeting = useMemo(() => {
    if (greetingPrefix) return greetingPrefix;
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, [greetingPrefix]);

  const quote = useMemo(() => getDailyQuote(), []);

  return (
    <div className="hm-hero">
      <div className="hm-eyebrow-row">
        <span className="hm-eyebrow">{eyebrow}</span>
        <span className="hm-role">{roleLabel}</span>
      </div>
      <h1 className="hm-greet">
        {greeting}, {firstName}<span className="dot">.</span>
      </h1>
      <p className="hm-sub">{quote}</p>
    </div>
  );
}
