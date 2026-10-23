/**
 * Hub-owned panels (cards, payments, payouts, opportunities, support) are
 * fetched live from Squad Hub. When it can't be reached the SaaS server
 * answers 503 { code: 'hub_unavailable' }; these helpers render that as a
 * calm "temporarily unavailable" note instead of an error — tasks, chat and
 * everything else keep working.
 */
export function isHubUnavailable(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { code?: string } } } | null;
  return e?.response?.status === 503 && e.response.data?.code === 'hub_unavailable';
}

export function apiErrorCode(err: unknown): string | null {
  return (err as { response?: { data?: { code?: string } } } | null)?.response?.data?.code ?? null;
}

export function apiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return (err as { response?: { data?: { error?: string } } } | null)?.response?.data?.error || fallback;
}

export default function HubUnavailable({ what, onRetry }: { what?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
      <h3 className="text-[14px] font-semibold text-amber-900 dark:text-amber-300">
        {what ? `${what} is temporarily unavailable` : 'Temporarily unavailable'}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-amber-800/80 dark:text-amber-200/80">
        We couldn&apos;t reach Squad Hub just now. Your tasks and chat keep working — please try again in a few minutes.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
        >
          Try again
        </button>
      )}
    </div>
  );
}
