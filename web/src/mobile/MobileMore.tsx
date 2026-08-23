'use client';

/**
 * Mobile "More" tab — the native apps' `ui/more/MoreScreen.kt` account menu
 * (profile block, Profile / Notifications / Resources / Settings / Help,
 * Log out), plus web-only extras the Android apps don't host yet.
 */

import type { HomeView } from '../layouts/MainLayout';
import { AppIcon, type AppDef } from '../config/apps';
import { useAvailableApps } from '../hooks/useApps';
import { useHasMiniApp } from '../hooks/useMiniApps';
import { useIsClient, useIsPartner } from '../hooks/useUserType';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { MAvatar, MGroupHead, MIcon, MRow } from './MobileKit';

export type MoreTarget =
  | { kind: 'view'; view: HomeView; title: string }
  | { kind: 'section'; section: 'cal' | 'docs' | 'learning'; title: string }
  | { kind: 'app'; app: AppDef }
  | { kind: 'settings' };

export default function MobileMore({
  onOpen,
  onOpenAccount,
  onLogout,
}: {
  onOpen: (t: MoreTarget) => void;
  onOpenAccount: () => void;
  onLogout: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const hasNotes = useHasMiniApp('squad-notes');
  const apps = useAvailableApps();

  return (
    <div style={{ padding: 'calc(var(--m-safe-top) + 16px) 0 96px' }}>
      {/* Profile block — MoreScreen.kt's ProfileBlock. */}
      <button type="button" className="msh-more-profile" onClick={onOpenAccount}>
        <MAvatar name={user?.display_name || user?.email} url={user?.avatar_url} size={48} presence />
        <span className="who">
          <b>{user?.display_name || 'Me'}</b>
          <span>{user?.email}</span>
        </span>
      </button>

      <div className="msh-more-hair" />

      {/* Same account rows as the native More tab / drawer. */}
      <MRow icon={MIcon.profile} title="Profile" onClick={onOpenAccount} />
      <MRow
        icon={MIcon.bell}
        title="Notifications"
        subtitle="Manage browser alerts in your browser settings"
        onClick={onOpenAccount}
      />
      <MRow
        icon={MIcon.resources}
        title="Resources"
        onClick={() => onOpen({ kind: 'section', section: 'learning', title: 'Resources' })}
      />
      <MRow icon={MIcon.settings} title="Settings" onClick={() => onOpen({ kind: 'settings' })} />
      <MRow
        icon={MIcon.help}
        title="Help & feedback"
        onClick={() => onOpen({ kind: 'section', section: 'learning', title: 'Resources' })}
      />
      <MRow icon={MIcon.logout} title="Log out" danger onClick={onLogout} trailing={<span />} />

      {/* Web-only extras the native apps don't host yet — client portal rows
          for business users, workspace/partner rows for everyone else. */}
      {isClient && (
        <>
          <MGroupHead title="My account" />
          <MRow icon={MIcon.card} title="Subscriptions" onClick={() => onOpen({ kind: 'view', view: 'subscription-cards', title: 'Subscriptions' })} />
          <MRow icon={MIcon.people} title="Hiring" onClick={() => onOpen({ kind: 'view', view: 'job-cards', title: 'Hiring' })} />
          <MRow icon={MIcon.wallet} title="Cash Book" onClick={() => onOpen({ kind: 'view', view: 'cashbook', title: 'Cash Book' })} />
          {hasNotes && (
            <MRow icon={MIcon.docs} title="Docs" onClick={() => onOpen({ kind: 'section', section: 'docs', title: 'Docs' })} />
          )}
        </>
      )}

      {!isClient && (
        <>
          <MGroupHead title="Workspace" />
          <MRow icon={MIcon.tasks} title="My Tasks" onClick={() => onOpen({ kind: 'view', view: 'my-tasks', title: 'My Tasks' })} />
          <MRow icon={MIcon.calendar} title="Calendar" onClick={() => onOpen({ kind: 'section', section: 'cal', title: 'Calendar' })} />
          <MRow icon={MIcon.planner} title="Day Planner" onClick={() => onOpen({ kind: 'view', view: 'day-planner', title: 'Day Planner' })} />
          <MRow icon={MIcon.clock} title="Routines" onClick={() => onOpen({ kind: 'view', view: 'routines', title: 'Routines' })} />
          {hasNotes && (
            <MRow icon={MIcon.docs} title="Docs" onClick={() => onOpen({ kind: 'section', section: 'docs', title: 'Docs' })} />
          )}
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

/** SettingsScreen.kt — Appearance (System / Light / Dark). */
export function MobileSettings() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const options = [
    { value: 'auto' as const, label: 'System default', subtitle: 'Match your device theme', icon: MIcon.phone },
    { value: 'light' as const, label: 'Light', icon: MIcon.sun },
    { value: 'dark' as const, label: 'Dark', icon: MIcon.moon },
  ];

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <MGroupHead title="Appearance" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="msh-row"
          data-on={theme === o.value ? 'true' : undefined}
          onClick={() => setTheme(o.value)}
        >
          <span className="msh-row-ic">{o.icon}</span>
          <span className="msh-row-body">
            <b>{o.label}</b>
            {'subtitle' in o && o.subtitle && <span>{o.subtitle}</span>}
          </span>
          {theme === o.value && <span className="msh-row-chev" style={{ color: 'var(--m-accent)' }}>{MIcon.tick}</span>}
        </button>
      ))}
    </div>
  );
}
