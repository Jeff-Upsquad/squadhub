'use client';

/**
 * Mobile Home — spaces-first, the same shape as the Business Android app's
 * `ui/home/HomeScreen.kt`: uppercase group headings, one tappable card per
 * space, an inline "+" that creates into that space, and a FAB (owned by the
 * shell) for the general case.
 *
 * The grouping itself lives in useMobileSpaces so the create sheet's list
 * picker offers exactly the spaces shown here.
 */

import { usePMStore } from '../stores/pmStore';
import { MCard, MEmpty, MGroupHead, MIcon, MLoading } from './MobileKit';
import { useMobileSpaces, type OpenTarget, type SpaceCard, type SpaceGroup } from './useMobileSpaces';

export type { OpenTarget } from './useMobileSpaces';

const ICON_FOR: Record<SpaceCard['icon'], React.ReactNode> = {
  space: MIcon.space,
  folder: MIcon.folder,
  design: MIcon.design,
  list: MIcon.list,
};

export default function MobileHome({
  workspaceId,
  onOpen,
  onCreateIn,
}: {
  workspaceId: string | undefined;
  onOpen: (t: OpenTarget) => void;
  /** Inline "+" on a card — creates a task scoped to that space. */
  onCreateIn: (t: OpenTarget) => void;
}) {
  const { groups, loading } = useMobileSpaces(workspaceId);

  if (loading) return <MLoading />;

  if (groups.every((g) => g.cards.length === 0)) {
    return (
      <MEmpty
        title="Nothing here yet"
        body="Spaces you're a member of will show up here. Tap + to create your first task."
      />
    );
  }

  return (
    <div style={{ padding: '8px 0 96px' }}>
      <MobileSpaceGroups groups={groups} onOpen={onOpen} onCreateIn={onCreateIn} />
    </div>
  );
}

/**
 * The grouped space cards. Client Home is nothing but this; the partner Home
 * puts it under its briefing, so it lives here rather than inline.
 */
export function MobileSpaceGroups({
  groups,
  onOpen,
  onCreateIn,
}: {
  groups: SpaceGroup[];
  onOpen: (t: OpenTarget) => void;
  onCreateIn: (t: OpenTarget) => void;
}) {
  return (
    <>
      {groups.map((g) => {
        if (!g.cards.length && !g.emptyHint) return null;
        return (
          <div key={g.key} data-tour="spaces">
            <MGroupHead title={g.heading} count={g.cards.length || undefined} />
            {g.cards.length === 0 ? (
              <p className="msh-hint">{g.emptyHint}</p>
            ) : (
              g.cards.map((c, i) => (
                <MCard
                  key={c.id}
                  index={i}
                  title={c.title}
                  subtitle={c.subtitle}
                  icon={ICON_FOR[c.icon]}
                  seed={c.id}
                  onOpen={() => onOpen(c.target)}
                  onAdd={() => onCreateIn(c.target)}
                />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

/** Drive the PM store so the shared `renderPane` shows the tapped target. */
export function applyOpenTarget(t: OpenTarget) {
  const pm = usePMStore.getState();
  switch (t.kind) {
    case 'space':
      pm.setActiveSpace(t.id);
      pm.setActiveSpacePage(t.id);
      break;
    case 'folder':
      pm.setActiveSpace(t.spaceId);
      pm.setActiveFolder(t.id);
      break;
    case 'design':
      pm.setActiveSpace(t.spaceId);
      pm.setActiveDesignFolder(t.id);
      break;
    case 'list':
      pm.setActiveSpace(t.spaceId);
      pm.setActiveList(t.id);
      break;
  }
}
