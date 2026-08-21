'use client';

/**
 * Mobile Chat tab — the conversation list, matching the Business app's
 * `ui/chat/ChatScreen.kt`: a Channels section then a Direct messages section,
 * each row tapping through to the full conversation (which the shell hosts as
 * a drilled-in section).
 *
 * Support gets its own row at the top when the workspace has a help desk, so
 * clients can reach it without hunting through the channel list.
 */

import { useMemo, useState } from 'react';
import type { Channel, DmConversation } from '@squadhub/shared';
import { usePresenceStore } from '../stores/presenceStore';
import { MAvatar, MEmpty, MGroupHead, MIcon, MRow } from './MobileKit';

export default function MobileChat({
  channels,
  dms,
  meId,
  supportChannelId,
  supportUnread,
  onOpenChannel,
  onOpenDm,
  onNewDm,
}: {
  channels: Channel[];
  dms: DmConversation[];
  meId: string | undefined;
  supportChannelId: string | null;
  supportUnread: number;
  onOpenChannel: (id: string, title: string) => void;
  onOpenDm: (id: string, title: string) => void;
  onNewDm: () => void;
}) {
  const [q, setQ] = useState('');
  const onlineUserIds = usePresenceStore((s) => s.onlineUserIds);
  const needle = q.trim().toLowerCase();

  // The support channel gets its own row above, so drop it from the list.
  // CRM-linked channels need no filtering here — GET /channels already strips
  // them server-side, and filtering again only risks hiding real channels.
  const visibleChannels = useMemo(
    () => channels.filter((c) => c.id !== supportChannelId && c.channel_kind !== 'support'),
    [channels, supportChannelId],
  );

  const dmTitle = (d: DmConversation) => {
    const others = (d.participants ?? []).filter((p) => p.id !== meId);
    if (others.length === 0) return 'Note to self';
    if (others.length === 1) return others[0].display_name || 'Unknown';
    return `${others[0].display_name} +${others.length - 1}`;
  };

  const filteredChannels = visibleChannels.filter((c) => !needle || c.name.toLowerCase().includes(needle));
  const filteredDms = dms.filter((d) => !needle || dmTitle(d).toLowerCase().includes(needle));

  const nothing = !filteredChannels.length && !filteredDms.length;

  return (
    <div style={{ padding: '4px 0 96px' }}>
      {/* In-sheet filter — the header's search pill opens the global palette;
          this one just narrows the list you're looking at. */}
      <div style={{ padding: '10px 16px 4px' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height: 40,
            padding: '0 13px',
            borderRadius: 13,
            background: 'var(--m-surface-alt)',
            color: 'var(--m-ink-3)',
          }}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 17, height: 17, flex: 'none' }}>
            {MIcon.search}
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter conversations"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              border: 0,
              background: 'transparent',
              outline: 'none',
              fontSize: 14.5,
              color: 'var(--m-ink)',
            }}
          />
        </label>
      </div>

      {supportChannelId && !needle && (
        <>
          <MGroupHead title="Help desk" />
          <MRow
            icon={MIcon.support}
            title="Support"
            subtitle="Chat with the SquadHub team"
            badge={supportUnread}
            unread={supportUnread > 0}
            onClick={() => onOpenChannel(supportChannelId, 'Support')}
          />
        </>
      )}

      <MGroupHead title="Channels" count={filteredChannels.length || undefined} />
      {filteredChannels.length === 0 ? (
        // "No match" is only true when something was typed. With an empty
        // filter the honest message is that they're in no channels yet.
        <p className="msh-hint">
          {needle
            ? 'No channels match.'
            : "You're not in any channels yet. Someone with access can add you to one."}
        </p>
      ) : (
        filteredChannels.map((c) => (
          <MRow
            key={c.id}
            icon={<span aria-hidden>#</span>}
            title={c.name}
            subtitle={c.description || undefined}
            onClick={() => onOpenChannel(c.id, c.name)}
          />
        ))
      )}

      <MGroupHead title="Direct messages" count={filteredDms.length || undefined} />
      {filteredDms.length === 0 && (
        <p className="msh-hint">
          {needle ? 'No conversations match.' : 'No direct messages yet.'}
        </p>
      )}
      {filteredDms.map((d) => {
        const others = (d.participants ?? []).filter((p) => p.id !== meId);
        const first = others[0] ?? d.participants?.[0];
        return (
          <MRow
            key={d.id}
            icon={
              <MAvatar
                name={first?.display_name}
                url={first?.avatar_url}
                size={36}
                presence={others.length === 1 ? onlineUserIds.has(first?.id ?? '') : undefined}
              />
            }
            title={dmTitle(d)}
            onClick={() => onOpenDm(d.id, dmTitle(d))}
          />
        );
      })}
      <MRow
        icon={MIcon.plus}
        title="New message"
        onClick={onNewDm}
        trailing={<span />}
      />

      {nothing && needle && <MEmpty title="No matches" body={`Nothing matched "${q}".`} />}
    </div>
  );
}
