import type { DmConversation } from '@squadhub/shared';
import { useAuthStore } from '../../../stores/authStore';

interface Props {
  dm: DmConversation;
  active: boolean;
  onClick: () => void;
}

export default function DmListItem({ dm, active, onClick }: Props) {
  const meId = useAuthStore((s) => s.user?.id);
  const others = (dm.participants || []).filter((p) => p.id !== meId);

  const label =
    others.length === 0
      ? 'Just you'
      : others.length === 1
        ? others[0].display_name
        : others.length === 2
          ? `${others[0].display_name}, ${others[1].display_name}`
          : `${others[0].display_name} + ${others.length - 1}`;

  const firstAvatar = others[0];
  const initials = (firstAvatar?.display_name?.[0] || '?').toUpperCase();

  return (
    <button
      onClick={onClick}
      className={`mb-[1px] flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
        active
          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-[#E2E8F0] text-[10px] font-bold text-[#0F172B] overflow-hidden">
        {firstAvatar?.avatar_url ? (
          <img src={firstAvatar.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
