import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Folder } from '@squadhub/shared';
import './design.css';
import { useSpace } from '../../../../hooks/useSpaces';
import { sortStages } from '../../../../lib/designSpaceLists';
import { useFolderTasks } from '../../../../hooks/useFolderTasks';
import { useClientDesignPlan } from '../../../../hooks/useClientDesignPlan';
import { canAtLeast } from '../../../../lib/access';
import ClientDesignDashboard from './ClientDesignDashboard';
import PublicClientLink from './PublicClientLink';
import ContainerChatButton from '../../../../components/pm/ContainerChatButton';

// Per-space numbers the overview rolls up into client-level totals. Kept to
// plain primitives so the lift-up to the parent can be equality-compared cheaply
// (see SpaceSummaryRow's memo + handleMetrics guard).
interface SpaceMetrics {
  active: number;
  inProgress: number;
  inReview: number;
  done: number;
  usedWeek: number;
  weeklyHours: number;
  usedMonth: number;
  monthlyHours: number;
}

const ZERO_TOTALS: SpaceMetrics = {
  active: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
  usedWeek: 0,
  weeklyHours: 0,
  usedMonth: 0,
  monthlyHours: 0,
};

const OverviewIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
  </svg>
);

const SpaceTabIcon = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4H4a1 1 0 00-1 1v5h8V4zM20 4h-7v5h8V5a1 1 0 00-1-1zM21 12h-8v8h7a1 1 0 001-1v-7zM11 12H3v7a1 1 0 001 1h7v-8z" />
  </svg>
);

export default function ClientFolderReport({ folder }: { folder: Folder }) {
  const { data: space, isLoading: spaceLoading } = useSpace(folder.space_id);

  // Child "spaces" of a client folder are sub-folders bound to a client-space
  // template (design / video workspaces). Mirrors SpaceTree's parent-id grouping;
  // restricted to template folders because each tab embeds ClientDesignDashboard,
  // which only renders meaningfully for a template-backed space.
  const childSpaces = useMemo(
    () =>
      (space?.folders ?? [])
        .filter((f) => f.parent_folder_id === folder.id && !!f.client_space_template_id)
        .sort((a, b) => a.position - b.position),
    [space?.folders, folder.id],
  );

  const [activeTab, setActiveTab] = useState<string>('all'); // 'all' | <spaceId>
  const [showLink, setShowLink] = useState(false);
  const isManager = canAtLeast((folder as { my_access_level?: string }).my_access_level as never, 'manager');

  // If the open space tab disappears (space deleted while viewing), fall back to
  // the overview so we never render a dashboard for a missing folder.
  useEffect(() => {
    if (activeTab !== 'all' && !childSpaces.some((s) => s.id === activeTab)) {
      setActiveTab('all');
    }
  }, [activeTab, childSpaces]);

  return (
    // min-h-0 / min-w-0 are load-bearing: this is a flex child of MainLayout's
    // column container, and the embedded dashboard's tall Reports tab needs the
    // inner scroller to take over instead of overflowing (matches the contract in
    // ClientDesignDashboard's root comment).
    <div className="flex flex-1 flex-col min-h-0 min-w-0">
      <div className="lv-breadcrumb-row">
        <div className="lv-breadcrumb">
          <span className="lv-bc-link">Client</span>
          <span className="lv-bc-sep">/</span>
          <span className="lv-bc-current">{folder.name}</span>
        </div>
        {isManager && (
          <button
            onClick={() => setShowLink(true)}
            className="lv-icon-btn"
            title="Public client link"
            aria-label="Public client link"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </button>
        )}
      </div>

      {/* Space tabs: All Spaces overview + one per child space */}
      <div className="lv-tabs-row">
        <button className="lv-tab" data-active={activeTab === 'all'} onClick={() => setActiveTab('all')}>
          {OverviewIcon}
          All Spaces
        </button>
        {childSpaces.map((s) => (
          <button
            key={s.id}
            className="lv-tab"
            data-active={activeTab === s.id}
            onClick={() => setActiveTab(s.id)}
          >
            {SpaceTabIcon}
            {s.name}
          </button>
        ))}
        <ContainerChatButton
          resourceType="folder"
          resourceId={folder.id}
          name={folder.name}
          accessLevel={(folder as { my_access_level?: string }).my_access_level}
          style={{ marginLeft: 'auto' }}
        />
      </div>

      {/* Only the active tab's dashboard mounts — keeps its global key listeners
          and data fetching from stacking across spaces. */}
      <div className="flex flex-1 min-h-0 min-w-0">
        {activeTab === 'all' ? (
          <ClientFolderOverview
            spaces={childSpaces}
            spaceLoading={spaceLoading}
            onOpenSpace={setActiveTab}
          />
        ) : (
          <ClientDesignDashboard folderId={activeTab} />
        )}
      </div>

      {showLink && (
        <PublicClientLink folderId={folder.id} folderName={folder.name} onClose={() => setShowLink(false)} />
      )}
    </div>
  );
}

function ClientFolderOverview({
  spaces,
  spaceLoading,
  onOpenSpace,
}: {
  spaces: Folder[];
  spaceLoading: boolean;
  onOpenSpace: (id: string) => void;
}) {
  const [metricsMap, setMetricsMap] = useState<Record<string, SpaceMetrics>>({});

  // Children report their metrics up; skip the state write (and re-render) when
  // nothing changed so the useFolderTasks/useClientDesignPlan churn doesn't loop.
  const handleMetrics = useCallback((spaceId: string, m: SpaceMetrics) => {
    setMetricsMap((prev) => {
      const e = prev[spaceId];
      if (
        e &&
        e.active === m.active &&
        e.inProgress === m.inProgress &&
        e.inReview === m.inReview &&
        e.done === m.done &&
        e.usedWeek === m.usedWeek &&
        e.weeklyHours === m.weeklyHours &&
        e.usedMonth === m.usedMonth &&
        e.monthlyHours === m.monthlyHours
      ) {
        return prev;
      }
      return { ...prev, [spaceId]: m };
    });
  }, []);

  // Drop metrics for spaces that no longer exist so totals stay accurate.
  useEffect(() => {
    setMetricsMap((prev) => {
      const ids = new Set(spaces.map((s) => s.id));
      let changed = false;
      const next: Record<string, SpaceMetrics> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (ids.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [spaces]);

  const totals = useMemo<SpaceMetrics>(
    () =>
      Object.values(metricsMap).reduce(
        (acc, m) => ({
          active: acc.active + m.active,
          inProgress: acc.inProgress + m.inProgress,
          inReview: acc.inReview + m.inReview,
          done: acc.done + m.done,
          usedWeek: Math.round((acc.usedWeek + m.usedWeek) * 10) / 10,
          weeklyHours: acc.weeklyHours + m.weeklyHours,
          usedMonth: Math.round((acc.usedMonth + m.usedMonth) * 10) / 10,
          monthlyHours: acc.monthlyHours + m.monthlyHours,
        }),
        { ...ZERO_TOTALS },
      ),
    [metricsMap],
  );

  if (!spaceLoading && spaces.length === 0) {
    return (
      <div className="cd-root flex-1 overflow-y-auto">
        <div
          style={{
            margin: '40px 24px',
            padding: 28,
            fontSize: 13,
            color: 'var(--cd-fg-3)',
            textAlign: 'center',
            border: '1px dashed var(--cd-br-1)',
            borderRadius: 8,
          }}
        >
          No spaces under this client yet. Add a space from the sidebar to see its
          report here.
        </div>
      </div>
    );
  }

  const weekPct = totals.weeklyHours
    ? Math.round((totals.usedWeek / totals.weeklyHours) * 100)
    : 0;
  const monthPct = totals.monthlyHours
    ? Math.round((totals.usedMonth / totals.monthlyHours) * 100)
    : 0;

  const kpis: {
    label: string;
    accent: string;
    num: number;
    unit: string;
    foot: string;
    pct: number | null;
  }[] = [
    {
      label: 'Active requests',
      accent: 'var(--cd-progress)',
      num: totals.active,
      unit: 'open',
      foot: `${totals.inProgress} in progress`,
      pct: null,
    },
    {
      label: 'In review',
      accent: 'var(--cd-review)',
      num: totals.inReview,
      unit: 'tasks',
      foot: 'awaiting review',
      pct: null,
    },
    {
      label: 'Completed',
      accent: 'var(--cd-done)',
      num: totals.done,
      unit: 'done',
      foot: `across ${spaces.length} space${spaces.length === 1 ? '' : 's'}`,
      pct: null,
    },
    {
      label: 'This week',
      accent: 'var(--cd-acc)',
      num: totals.usedWeek,
      unit: `/ ${totals.weeklyHours}h`,
      foot: `${weekPct}% of plan`,
      pct: weekPct,
    },
    {
      label: 'This month',
      accent: 'var(--cd-done)',
      num: totals.usedMonth,
      unit: `/ ${totals.monthlyHours}h`,
      foot: `${monthPct}% used`,
      pct: monthPct,
    },
  ];

  return (
    <div className="cd-root flex-1 overflow-y-auto">
      <div className="cd-kpi-row" data-count={5}>
        {kpis.map((k) => (
          <div
            className="cd-kpi"
            key={k.label}
            style={{ '--kpi-accent': k.accent } as React.CSSProperties}
          >
            <div className="cd-kpi-top">
              <div className="cd-kpi-label">
                <span className="cd-kpi-dot" />
                {k.label}
              </div>
            </div>
            <div className="cd-kpi-value">
              <span className="cd-kpi-num">{k.num}</span>
              <span className="cd-kpi-unit">{k.unit}</span>
            </div>
            <div className="cd-kpi-foot">
              {k.pct != null && (
                <div className="cd-kpi-progress">
                  <span style={{ width: `${Math.min(100, Math.max(0, k.pct))}%` }} />
                </div>
              )}
              <div className="cd-kpi-delta">{k.foot}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '20px 24px 40px' }}>
        <div className="cd-section-head">
          <div className="cd-section-title">
            Spaces<span className="mono-count">{spaces.length}</span>
          </div>
        </div>
        {spaces.map((s) => (
          <SpaceSummaryRow
            key={s.id}
            space={s}
            onMetrics={handleMetrics}
            onClick={() => onOpenSpace(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SpaceSummaryRow({
  space,
  onMetrics,
  onClick,
}: {
  space: Folder;
  onMetrics: (id: string, m: SpaceMetrics) => void;
  onClick: () => void;
}) {
  const { data: spaceData } = useSpace(space.space_id ?? null);
  const sortedStatuses = useMemo(
    () => sortStages((spaceData as any)?.space_statuses || spaceData?.statuses || []),
    [spaceData],
  );
  const { requests, byStatus } = useFolderTasks(space.id, sortedStatuses);
  const plan = useClientDesignPlan(space.id);

  // Depend on the plan PRIMITIVES, not the plan object — useClientDesignPlan
  // returns a fresh object every render, so depending on it would defeat the memo
  // and (via the lift-up effect) loop. requests/byStatus are already memo-stable.
  const metrics = useMemo<SpaceMetrics>(
    () => ({
      active: requests.filter((r) => r._derivedStatus !== 'done').length,
      inProgress: byStatus.progress.length,
      inReview: byStatus.review.length,
      done: byStatus.done.length,
      usedWeek: plan.usedWeek,
      weeklyHours: plan.weeklyHours,
      usedMonth: plan.usedMonth,
      monthlyHours: plan.monthlyHours,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, byStatus, plan.usedWeek, plan.weeklyHours, plan.usedMonth, plan.monthlyHours],
  );

  useEffect(() => {
    onMetrics(space.id, metrics);
  }, [space.id, metrics, onMetrics]);

  const over = metrics.usedWeek > metrics.weeklyHours;
  const weekPct = metrics.weeklyHours
    ? Math.min(100, Math.round((metrics.usedWeek / metrics.weeklyHours) * 100))
    : 0;

  return (
    <button
      type="button"
      className="cd-designer-card"
      style={{ width: '100%', textAlign: 'left' }}
      onClick={onClick}
    >
      <div className="cd-designer-info">
        <div className="cd-designer-name">{space.name}</div>
        <div className="cd-designer-role">
          {metrics.active} active · {metrics.inProgress} in progress · {metrics.inReview} in review
        </div>
      </div>
      <div style={{ minWidth: 160 }}>
        <div className="cd-bar-track">
          <div
            className={`cd-bar-fill${over ? ' over' : ''}`}
            style={{ width: `${weekPct}%` }}
          />
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: 'var(--cd-font-mono)',
            fontSize: 10.5,
            color: over ? 'var(--cd-danger)' : 'var(--cd-fg-2)',
            textAlign: 'right',
          }}
        >
          {metrics.usedWeek}/{metrics.weeklyHours}h this week
        </div>
      </div>
      <svg
        className="h-4 w-4"
        style={{ color: 'var(--cd-fg-3)', flexShrink: 0 }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
