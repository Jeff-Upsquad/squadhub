'use client';

/**
 * Partner Home — a short launchpad for the work a partner has been given.
 *
 * Focus and Favorites stay compact on the page and open as bottom sheets. The
 * remainder deliberately mirrors the Business app: assigned client workspaces
 * first, then the areas shared inside those workspaces.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { Favorite, Task } from '@squadhub/shared';
import { useFavorites } from '../hooks/useFavorites';
import { useMyTasksSummary } from '../hooks/useMyTasksSummary';
import { usePMStore } from '../stores/pmStore';
import { MIcon } from './MobileKit';
import { MobileSpaceGroups } from './MobileHome';
import { useMobileSpaces, type OpenTarget } from './useMobileSpaces';

type HomeSheet = 'focus' | 'favorites' | null;

export default function MobilePartnerHome({
  workspaceId,
  onOpen,
  onCreateIn,
  onOpenFavorite,
}: {
  workspaceId: string | undefined;
  onOpen: (t: OpenTarget) => void;
  onCreateIn: (t: OpenTarget) => void;
  onOpenFavorite: (favorite: Favorite) => void;
}) {
  const { data: buckets, isLoading: tasksLoading } = useMyTasksSummary();
  const { data: favorites = [], isLoading: favoritesLoading } = useFavorites(workspaceId);
  const { groups } = useMobileSpaces(workspaceId);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const [sheet, setSheet] = useState<HomeSheet>(null);

  const focused = buckets?.focused ?? [];

  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  const openTask = (taskId: string) => {
    setSheet(null);
    setActiveTask(taskId);
  };

  const openFavorite = (favorite: Favorite) => {
    setSheet(null);
    onOpenFavorite(favorite);
  };

  return (
    <>
      <div className="mph-home">
        <div className="mph-launch-grid" data-tour="home-cards">
          <LaunchCard
            title="Focus"
            description="Tasks you starred for attention"
            count={tasksLoading ? undefined : focused.length}
            icon={MIcon.star}
            tone="focus"
            onClick={() => setSheet('focus')}
          />
          <LaunchCard
            title="Favorites"
            description="Your saved spaces and lists"
            count={favoritesLoading ? undefined : favorites.length}
            icon={MIcon.bookmark}
            tone="favorite"
            onClick={() => setSheet('favorites')}
          />
        </div>

        <MobileSpaceGroups groups={groups} onOpen={onOpen} onCreateIn={onCreateIn} />
      </div>

      {sheet && (
        <div className="mph-sheet-layer">
          <button
            type="button"
            className="mph-sheet-scrim"
            aria-label="Close"
            onClick={() => setSheet(null)}
          />
          <section
            className="mph-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`mph-${sheet}-title`}
          >
            <div className="mph-sheet-handle" aria-hidden />
            <header className="mph-sheet-head">
              <span className="mph-sheet-head-icon">
                {sheet === 'focus' ? MIcon.star : MIcon.bookmark}
              </span>
              <span>
                <h2 id={`mph-${sheet}-title`}>{sheet === 'focus' ? 'Focus' : 'Favorites'}</h2>
                <p>
                  {sheet === 'focus'
                    ? `${focused.length} ${focused.length === 1 ? 'task' : 'tasks'} in your focus list`
                    : `${favorites.length} saved ${favorites.length === 1 ? 'item' : 'items'}`}
                </p>
              </span>
              <button type="button" className="mph-sheet-close" aria-label="Close" onClick={() => setSheet(null)}>
                {MIcon.close}
              </button>
            </header>

            <div className="mph-sheet-list">
              {sheet === 'focus' ? (
                tasksLoading ? (
                  <SheetEmpty title="Loading your focus list…" />
                ) : focused.length === 0 ? (
                  <SheetEmpty title="Your focus list is clear" body="Star a task to keep it close at hand." />
                ) : (
                  focused.map((task) => (
                    <TaskSheetRow key={task.id} task={task} onClick={() => openTask(task.id)} />
                  ))
                )
              ) : favoritesLoading ? (
                <SheetEmpty title="Loading favorites…" />
              ) : favorites.length === 0 ? (
                <SheetEmpty title="No favorites yet" body="Star a workspace, area, list, or channel to find it here." />
              ) : (
                favorites.map((favorite) => (
                  <FavoriteSheetRow key={favorite.id} favorite={favorite} onClick={() => openFavorite(favorite)} />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function LaunchCard({
  title,
  description,
  count,
  icon,
  tone,
  onClick,
}: {
  title: string;
  description: string;
  count: number | undefined;
  icon: ReactNode;
  tone: 'focus' | 'favorite';
  onClick: () => void;
}) {
  return (
    <button type="button" className="mph-launch-card" data-tone={tone} onClick={onClick}>
      <span className="mph-launch-icon">{icon}</span>
      <span className="mph-launch-copy">
        <b>{title}</b>
        <span>{description}</span>
      </span>
      <span className="mph-launch-count">{count == null ? '—' : count}</span>
      <span className="mph-launch-chev">{MIcon.chevron}</span>
    </button>
  );
}

function TaskSheetRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const context = task.list?.name || task.folder?.name || task.space?.name;
  const date = task.work_date || task.due_date;
  return (
    <button type="button" className="mph-sheet-row" onClick={onClick}>
      <span className="mph-task-dot" data-p={task.priority ?? 'none'} aria-hidden />
      <span className="mph-sheet-row-body">
        <b>{task.title}</b>
        {(context || date) && (
          <span>{[context, date ? formatShortDate(date) : null].filter(Boolean).join(' · ')}</span>
        )}
      </span>
      <span className="msh-row-chev">{MIcon.chevron}</span>
    </button>
  );
}

function FavoriteSheetRow({ favorite, onClick }: { favorite: Favorite; onClick: () => void }) {
  return (
    <button type="button" className="mph-sheet-row" onClick={onClick}>
      <span className="mph-favorite-icon">{iconForFavorite(favorite.item_type)}</span>
      <span className="mph-sheet-row-body">
        <b>{favorite.item_name || 'Untitled'}</b>
        <span>{favoriteLabel(favorite.item_type)}</span>
      </span>
      <span className="msh-row-chev">{MIcon.chevron}</span>
    </button>
  );
}

function SheetEmpty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mph-sheet-empty">
      <span>{MIcon.star}</span>
      <b>{title}</b>
      {body && <p>{body}</p>}
    </div>
  );
}

function iconForFavorite(type: Favorite['item_type']) {
  if (type === 'channel') return MIcon.chatOutline;
  if (type === 'list') return MIcon.list;
  if (type === 'folder') return MIcon.folder;
  return MIcon.space;
}

function favoriteLabel(type: Favorite['item_type']) {
  if (type === 'channel') return 'Channel';
  if (type === 'list') return 'List';
  if (type === 'folder') return 'Area';
  return 'Workspace';
}

function formatShortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}
