'use client';

/**
 * Mobile "More" tab — everything the four-tab bar can't hold, in the same
 * grouped-rows shape as the Business app's `ui/more/MoreScreen.kt`.
 *
 * The rows are the phone's stand-in for the desktop rail: each one drives the
 * exact same `homeView` / `activeSection` state the rail buttons do, so the
 * shell can host the identical pane. Visibility follows the desktop rules —
 * user type for the workspace rows, mini-app access for the app rows.
 */

import type { HomeView } from '../layouts/MainLayout';
import { AppIcon, type AppDef } from '../config/apps';
import { useAvailableApps } from '../hooks/useApps';
import { useHasMiniApp } from '../hooks/useMiniApps';
import { useIsClient, useIsPartner } from '../hooks/useUserType';
import { useAuthStore } from '../stores/authStore';
import { MAvatar, MGroupHead, MIcon, MRow } from './MobileKit';

export type MoreTarget =
  | { kind: 'view'; view: HomeView; title: string }
  | { kind: 'section'; section: 'cal' | 'docs' | 'learning'; title: string }
  | { kind: 'app'; app: AppDef };

export default function MobileMore({
  onOpen,
  onOpenAccount,
}: {
  onOpen: (t: MoreTarget) => void;
  onOpenAccount: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const hasNotes = useHasMiniApp('squad-notes');
  const apps = useAvailableApps();

  return (
    <div style={{ padding: '4px 0 96px' }}>
      {/* Account card — the drawer holds settings + sign-out. */}
      <button
        type="button"
        onClick={onOpenAccount}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          width: 'calc(100% - 32px)',
          margin: '14px 16px 4px',
          padding: 14,
          border: 0,
          borderRadius: 'var(--m-r-md)',
          background: 'var(--m-surface-alt)',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <MAvatar name={user?.display_name || user?.email} url={user?.avatar_url} size={46} presence />
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 16, fontWeight: 650, letterSpacing: '-0.2px', color: 'var(--m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.display_name || 'Me'}
          </b>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--m-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </span>
        </span>
        <span className="msh-card-chev">{MIcon.chevron}</span>
      </button>

      <MGroupHead title="Workspace" />
      <MRow icon={MIcon.tasks} title="My Tasks" onClick={() => onOpen({ kind: 'view', view: 'my-tasks', title: 'My Tasks' })} />
      <MRow icon={MIcon.calendar} title="Calendar" onClick={() => onOpen({ kind: 'section', section: 'cal', title: 'Calendar' })} />
      {!isClient && (
        <>
          <MRow icon={MIcon.planner} title="Day Planner" onClick={() => onOpen({ kind: 'view', view: 'day-planner', title: 'Day Planner' })} />
          <MRow icon={MIcon.clock} title="Routines" onClick={() => onOpen({ kind: 'view', view: 'routines', title: 'Routines' })} />
        </>
      )}
      {hasNotes && (
        <MRow icon={MIcon.docs} title="Docs" onClick={() => onOpen({ kind: 'section', section: 'docs', title: 'Docs' })} />
      )}
      <MRow icon={MIcon.resources} title="Resources" onClick={() => onOpen({ kind: 'section', section: 'learning', title: 'Resources' })} />

      {isClient && (
        <>
          <MGroupHead title="My account" />
          <MRow icon={MIcon.card} title="Subscriptions" onClick={() => onOpen({ kind: 'view', view: 'subscription-cards', title: 'Subscriptions' })} />
          <MRow icon={MIcon.people} title="Hiring" onClick={() => onOpen({ kind: 'view', view: 'job-cards', title: 'Hiring' })} />
          <MRow icon={MIcon.wallet} title="Cash Book" onClick={() => onOpen({ kind: 'view', view: 'cashbook', title: 'Cash Book' })} />
        </>
      )}

      {isPartner && (
        <>
          <MGroupHead title="Partner" />
          <MRow icon={MIcon.card} title="Opportunities" onClick={() => onOpen({ kind: 'view', view: 'opportunities', title: 'Opportunities' })} />
          <MRow icon={MIcon.wallet} title="Cash Book" onClick={() => onOpen({ kind: 'view', view: 'cashbook', title: 'Cash Book' })} />
        </>
      )}

      {apps.length > 0 && (
        <>
          <MGroupHead title="Apps" count={apps.length} />
          {apps.map((app) => (
            <MRow
              key={app.slug}
              icon={<AppIcon paths={app.paths} className="h-[19px] w-[19px]" />}
              title={app.name}
              subtitle={app.description}
              onClick={() => onOpen({ kind: 'app', app })}
            />
          ))}
        </>
      )}
    </div>
  );
}
