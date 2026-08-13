'use client';

import AdminSupport from '@/views/admin/support/AdminSupport';

/**
 * Support Tickets — the team-facing triage console.
 *
 * Renders the admin panel's own AdminSupport module from source (web's `@`
 * alias falls back to admin/src), so the mini app and the admin route are one
 * implementation. Access is the `support` mini app; every /support triage
 * endpoint is gated by requireMiniAppOrAdmin('support') server-side.
 */
export default function SupportAdminPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <AdminSupport />
    </div>
  );
}
