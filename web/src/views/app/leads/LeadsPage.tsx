'use client';

import CardsHub from '@/views/admin/CardsHub';

/**
 * Requirement Cards — the team-facing home for new deals.
 *
 * The three sections are the admin panel's own pipeline modules, rendered from
 * the same CardsHub rather than reimplemented (web/next.config.mjs points `@`
 * at admin/src as a fallback root). So the team gets the real thing — brief
 * forms, broadcast, recipients funnel, candidates, interviews, offers — and
 * there is only ever one implementation to maintain.
 *
 * Access is the `leads` mini app; every endpoint those modules call is gated by
 * requireMiniAppOrAdmin('leads') server-side.
 */
export default function LeadsPage() {
  return <CardsHub title="Requirement Cards" />;
}
