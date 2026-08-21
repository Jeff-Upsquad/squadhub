'use client';

/**
 * The spaces the phone shell knows about, grouped the way Home shows them.
 *
 * Shared by MobileHome (which renders the groups as cards) and the create
 * sheet (which turns them into its list picker), so the two can never disagree
 * about what you're allowed to file a task into.
 *
 * Where they come from depends on who's looking, mirroring the desktop
 * SpaceTree: clients and partners own no areas, so their spaces arrive as
 * shared roots (`/pm/shared-tree`) grouped under each client folder; internal
 * users get workspace roots plus their own areas.
 */

import { useMemo } from 'react';
import type { Folder, List, Space } from '@squadhub/shared';
import { useSpaces, useWorkspaces } from '../hooks/useSpaces';
import { useSharedTree } from '../hooks/useSharedWithMe';
import { useIsClient, useIsPartner } from '../hooks/useUserType';

export type OpenTarget =
  | { kind: 'space'; id: string; title: string }
  | { kind: 'folder'; id: string; spaceId: string; title: string }
  | { kind: 'design'; id: string; spaceId: string; title: string }
  | { kind: 'list'; id: string; spaceId: string; title: string };

export type SpaceCard = {
  id: string;
  title: string;
  subtitle?: string;
  /** Which glyph to draw — resolved against MIcon by the caller. */
  icon: 'space' | 'folder' | 'design' | 'list';
  target: OpenTarget;
};

export type SpaceGroup = {
  key: string;
  heading: string;
  emptyHint?: string;
  cards: SpaceCard[];
};

export function useMobileSpaces(workspaceId: string | undefined): {
  groups: SpaceGroup[];
  loading: boolean;
} {
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const shared = isClient || isPartner;

  // Clients aren't allowed on GET /pm/spaces (internal/partner-only) and it
  // would 403 — skip the fetch for them exactly as SpaceTree does.
  const { data: spaces, isLoading: spacesLoading } = useSpaces(isClient ? undefined : workspaceId);
  const { data: wsRoots, isLoading: wsLoading } = useWorkspaces(shared ? undefined : workspaceId);
  const { data: tree, isLoading: treeLoading } = useSharedTree(workspaceId, shared);

  const groups = useMemo<SpaceGroup[]>(() => {
    const out: SpaceGroup[] = [];

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
      if (loose.length) out.push({ key: 'shared', heading: 'Shared with me', cards: loose });
      return out;
    }

    if (wsRoots?.length) {
      out.push({ key: 'workspaces', heading: 'Workspaces', cards: wsRoots.map(spaceCard) });
    }
    if (spaces?.length) {
      out.push({ key: 'areas', heading: 'Areas', cards: spaces.map(spaceCard) });
    }
    return out;
  }, [shared, tree, wsRoots, spaces]);

  return {
    groups,
    loading: shared ? treeLoading : spacesLoading || wsLoading,
  };
}

function spaceCard(s: Space): SpaceCard {
  return {
    id: s.id,
    title: s.name,
    subtitle: s.description || undefined,
    icon: 'space',
    target: { kind: 'space', id: s.id, title: s.name },
  };
}

function folderCard(f: Folder, clientName?: string): SpaceCard {
  // A folder created from a client-space template (e.g. "Design Space") opens
  // the design dashboard rather than the plain folder page — the same split the
  // desktop SpaceTree makes.
  const isTemplate = !!f.client_space_template_id;
  return {
    id: f.id,
    title: f.name,
    subtitle: clientName,
    icon: isTemplate ? 'design' : 'folder',
    target: isTemplate
      ? { kind: 'design', id: f.id, spaceId: f.space_id, title: f.name }
      : { kind: 'folder', id: f.id, spaceId: f.space_id, title: f.name },
  };
}

function listCard(l: List): SpaceCard {
  return {
    id: l.id,
    title: l.name,
    icon: 'list',
    target: { kind: 'list', id: l.id, spaceId: l.space_id, title: l.name },
  };
}
