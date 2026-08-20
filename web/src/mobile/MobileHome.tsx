'use client';

/**
 * Mobile Home — spaces-first, the same shape as the Business Android app's
 * `ui/home/HomeScreen.kt`: uppercase group headings, one tappable card per
 * space, an inline "+" that creates into that space, and a FAB (owned by the
 * shell) for the general case.
 *
 * Where the data comes from depends on who's looking, mirroring what the
 * desktop sidebar's SpaceTree does:
 *  - clients & partners own no areas, so their spaces arrive as shared roots
 *    (`/pm/shared-tree`) grouped under each client folder;
 *  - internal users get workspace roots + their areas (`/pm/workspaces`,
 *    `/pm/spaces`).
 */

import { useMemo } from 'react';
import type { Folder, List, Space } from '@squadhub/shared';
import { useSpaces, useWorkspaces } from '../hooks/useSpaces';
import { useSharedTree } from '../hooks/useSharedWithMe';
import { useIsClient, useIsPartner } from '../hooks/useUserType';
import { usePMStore } from '../stores/pmStore';
import { MCard, MEmpty, MGroupHead, MIcon, MLoading } from './MobileKit';

export type OpenTarget =
  | { kind: 'space'; id: string; title: string }
  | { kind: 'folder'; id: string; spaceId: string; title: string }
  | { kind: 'design'; id: string; spaceId: string; title: string }
  | { kind: 'list'; id: string; spaceId: string; title: string };

type Group = {
  key: string;
  heading: string;
  emptyHint?: string;
  cards: {
    id: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    target: OpenTarget;
    canAdd: boolean;
  }[];
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
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const shared = isClient || isPartner;

  // Clients are not allowed on GET /pm/spaces (internal/partner-only) and it
  // would 403 — skip the fetch for them exactly as SpaceTree does.
  const { data: spaces, isLoading: spacesLoading } = useSpaces(isClient ? undefined : workspaceId);
  const { data: wsRoots, isLoading: wsLoading } = useWorkspaces(isClient || isPartner ? undefined : workspaceId);
  const { data: tree, isLoading: treeLoading } = useSharedTree(workspaceId, shared);

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];

    if (shared) {
      for (const cf of tree?.clientFolders ?? []) {
        out.push({
          key: `client-${cf.id}`,
          heading: cf.name,
          emptyHint: 'No spaces here yet.',
          cards: (cf.childSpaces ?? []).map((s) => folderCard(s, cf.name)),
        });
      }
      const loose = [
        ...(tree?.folders ?? []).map((f) => folderCard(f)),
        ...(tree?.lists ?? []).map((l) => listCard(l)),
      ];
      if (loose.length) {
        out.push({ key: 'shared', heading: 'Shared with me', cards: loose });
      }
      return out;
    }

    if (wsRoots?.length) {
      out.push({
        key: 'workspaces',
        heading: 'Workspaces',
        cards: wsRoots.map((s) => spaceCard(s)),
      });
    }
    if (spaces?.length) {
      out.push({
        key: 'areas',
        heading: 'Areas',
        cards: spaces.map((s) => spaceCard(s)),
      });
    }
    return out;
  }, [shared, tree, wsRoots, spaces]);

  const loading = shared ? treeLoading : spacesLoading || wsLoading;
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
      {groups.map((g) => {
        if (!g.cards.length && !g.emptyHint) return null;
        return (
          <div key={g.key}>
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
                  icon={c.icon}
                  seed={c.id}
                  onOpen={() => onOpen(c.target)}
                  onAdd={c.canAdd ? () => onCreateIn(c.target) : undefined}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Card builders ----

function spaceCard(s: Space): Group['cards'][number] {
  return {
    id: s.id,
    title: s.name,
    subtitle: s.description || undefined,
    icon: MIcon.space,
    target: { kind: 'space', id: s.id, title: s.name },
    canAdd: true,
  };
}

function folderCard(f: Folder, clientName?: string): Group['cards'][number] {
  // A folder created from a client-space template (e.g. "Design Space") opens
  // the design dashboard rather than the plain folder page — same split the
  // desktop SpaceTree makes.
  const isTemplate = !!f.client_space_template_id;
  return {
    id: f.id,
    title: f.name,
    subtitle: clientName,
    icon: isTemplate ? MIcon.design : MIcon.folder,
    target: isTemplate
      ? { kind: 'design', id: f.id, spaceId: f.space_id, title: f.name }
      : { kind: 'folder', id: f.id, spaceId: f.space_id, title: f.name },
    canAdd: true,
  };
}

function listCard(l: List): Group['cards'][number] {
  return {
    id: l.id,
    title: l.name,
    icon: MIcon.list,
    target: { kind: 'list', id: l.id, spaceId: l.space_id, title: l.name },
    canAdd: true,
  };
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
