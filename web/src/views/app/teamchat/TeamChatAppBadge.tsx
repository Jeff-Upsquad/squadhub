'use client';

import { useCrmTeamChatUnread, type CrmTeamChatSource } from '../../../hooks/useCrmTeamChat';
import { CRM_TEAMCHAT_META } from './CrmTeamChatView';

/** Unread count pill for a CRM TeamChat mini-app row (Apps module + pinned sidebar). */
export default function TeamChatAppBadge({ source }: { source: CrmTeamChatSource }) {
  const { data } = useCrmTeamChatUnread(source);
  const total = data?.total ?? 0;
  if (total <= 0) return null;
  return (
    <span
      title={`${CRM_TEAMCHAT_META[source].title}: ${total} unread`}
      className="shrink-0 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold leading-4 text-white"
      style={{ background: CRM_TEAMCHAT_META[source].accent }}
    >
      {total > 99 ? '99+' : total}
    </span>
  );
}
