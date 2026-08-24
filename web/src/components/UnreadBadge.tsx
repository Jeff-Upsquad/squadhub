interface Props {
  count: number;
}

/** Monochrome unread-count pill for sidebar chat/channel rows. */
export default function UnreadBadge({ count }: Props) {
  if (count <= 0) return null;
  return (
    <span
      className="grid h-[16px] min-w-[16px] shrink-0 place-items-center rounded-full bg-[var(--sh-ink)] px-[5px] text-[10px] font-semibold leading-none text-[var(--sidebar)]"
      style={{ fontFamily: 'var(--font-mono, Inter, sans-serif)' }}
      title={`${count} unread`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
