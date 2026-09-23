'use client';

/**
 * The Work surface for a partner who hasn't got their first project yet.
 *
 * Talents can now sign in to SquadHub before any work exists for them, so
 * Discover can bring them their first opportunity (see utils/workAccess on the
 * server). Work isn't hidden in that state — it's shown locked, so it's obvious
 * that the rest of the app is theirs the moment they're assigned.
 */

export default function MobileWorkLocked({ onExplore }: { onExplore: () => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-7 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F4F4F5] text-[#52525B]">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 11V8a4 4 0 10-8 0v3m-1 0h10a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2z"
          />
        </svg>
      </div>

      <h2 className="mt-5 text-[21px] font-extrabold tracking-[-0.01em] text-[#0A0A0A]">
        Work unlocks with your first project
      </h2>
      <p className="mt-2 max-w-[19rem] text-[13.5px] leading-relaxed text-[#71717A]">
        Your tasks, chats and updates live here. They open up as soon as a client assigns you —
        until then, find your first project in Discover.
      </p>

      <button
        type="button"
        onClick={onExplore}
        className="mt-6 w-full max-w-[19rem] rounded-xl bg-[#0A0A0A] px-5 py-3 text-[14px] font-bold text-white active:opacity-90"
      >
        Go to Discover
      </button>

      <ul className="mt-8 w-full max-w-[19rem] space-y-3 text-left">
        {[
          'Browse opportunities matched to your profile',
          'Accept work and negotiate your rate',
          'Get assigned — Work opens automatically',
        ].map((line, i) => (
          <li key={line} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#0A0A0A] text-[10px] font-bold text-white">
              {i + 1}
            </span>
            <span className="text-[13px] leading-snug text-[#3F3F46]">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
