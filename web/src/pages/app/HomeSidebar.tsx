import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';

// Icon for each favorite item type
function FavoriteIcon({ type }: { type: string }) {
  switch (type) {
    case 'channel':
      return (
        <svg className="h-4 w-4 shrink-0 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    case 'list':
      return (
        <svg className="h-4 w-4 shrink-0 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    case 'folder':
      return (
        <svg className="h-4 w-4 shrink-0 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case 'space':
      return (
        <svg className="h-4 w-4 shrink-0 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4 shrink-0 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      );
  }
}

export default function HomeSidebar({ workspaceId }: { workspaceId: string }) {
  const { data: favorites, isLoading } = useFavorites(workspaceId);
  const removeFavorite = useRemoveFavorite(workspaceId);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#eaeaea] px-4 py-3">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#171717]">Home</h2>
      </div>

      {/* Navigation items */}
      <div className="px-2 py-2">
        <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#666] transition hover:bg-[#f5f5f5] hover:text-[#171717]">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
          </svg>
          Inbox
        </button>

        <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#666] transition hover:bg-[#f5f5f5] hover:text-[#171717]">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          New Tasks
        </button>

        <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#666] transition hover:bg-[#f5f5f5] hover:text-[#171717]">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          Assigned Comments
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-[#eaeaea]" />

      {/* Favorites section */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <h3 className="mb-1 px-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#999]">
          Favorites
        </h3>

        {isLoading && (
          <p className="px-3 py-2 text-xs text-[#999]">Loading...</p>
        )}

        {!isLoading && (!favorites || favorites.length === 0) && (
          <p className="px-3 py-4 text-center text-xs text-[#999]">
            Star channels, lists or spaces to see them here
          </p>
        )}

        {favorites?.map((fav) => (
          <div key={fav.id} className="group flex items-center">
            <button className="flex flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-[#666] transition hover:bg-[#f5f5f5] hover:text-[#171717]">
              <FavoriteIcon type={fav.item_type} />
              <span className="truncate">{fav.item_name}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeFavorite.mutate(fav.id);
              }}
              className="mr-2 hidden rounded p-0.5 text-[#999] transition hover:text-[#171717] group-hover:block"
              title="Remove from favorites"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
