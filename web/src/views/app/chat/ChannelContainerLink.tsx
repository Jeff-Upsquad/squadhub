import { useQuery } from '@tanstack/react-query';
import type { Channel } from '@squadhub/shared';
import api from '../../../services/api';
import { useSpace } from '../../../hooks/useSpaces';
import { useFolder } from '../../../hooks/useFolderTasks';

type ContainerType = 'space' | 'folder' | 'list';

/**
 * Shown in the chat header when the active channel is linked to a PM container.
 * Renders an "Open {container}" button that navigates back to that list / folder
 * / space — the reverse direction of the container header's "Chat" button.
 */
export default function ChannelContainerLink({
  channel,
  onOpen,
}: {
  channel: Channel | undefined;
  onOpen: (type: ContainerType, id: string) => void;
}) {
  const type = channel?.linked_resource_type as ContainerType | undefined;
  const id = channel?.linked_resource_id || null;

  const space = useSpace(type === 'space' ? id : null);
  const folder = useFolder(type === 'folder' ? id : null);
  const list = useQuery<{ name: string }>({
    queryKey: ['list', id],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${id}`);
      return res.data.data;
    },
    enabled: type === 'list' && !!id,
  });

  if (!type || !id) return null;

  const name =
    type === 'space' ? space.data?.name : type === 'folder' ? folder.data?.name : list.data?.name;
  const label = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <button
      type="button"
      className="sqc-pill"
      onClick={() => onOpen(type, id)}
      title={`Open the linked ${type}`}
    >
      <svg className="h-3.5 w-3.5 text-[var(--sh-text-2)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
      <span className="max-w-[160px] truncate">{name || `Open ${label}`}</span>
    </button>
  );
}
