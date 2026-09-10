'use client';

import { useCrmTeamChatUnread, type CrmTeamChatSource } from '../../../hooks/useCrmTeamChat';
import { useTeamChatEmbedStore } from '../../../stores/teamchatEmbedStore';
import { CRM_TEAMCHAT_META } from './CrmTeamChatView';

/** Unread count pill for a CRM TeamChat mini-app row (Apps module + pinned sidebar). */
export default function TeamChatAppBadge({ source }: { source: CrmTeamChatSource }) {
  return source === 'shcrm' ? <EmbedBadge /> : <NativeBadge />;
}

// SquadCRM shares SquadHub's database — polled directly via the proxy.
function NativeBadge() {
  const { data } = useCrmTeamChatUnread('crm');
  return <Pill source="crm" total={data?.total ?? 0} />;
}

// SquadHireCRM lives in its own project — counts arrive via the iframe bridge.
function EmbedBadge() {
  const total = useTeamChatEmbedStore((s) => s.shcrmUnread);
  return <Pill source="shcrm" total={total} />;
}

function Pill({ source, total }: { source: CrmTeamChatSource; total: number }) {
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
