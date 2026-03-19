import type { SpaceStatus } from '@squadhub/shared';

export default function TaskStatusBadge({ status }: { status: SpaceStatus | undefined }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${status.color}18`,
        color: status.color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      {status.name}
    </span>
  );
}
