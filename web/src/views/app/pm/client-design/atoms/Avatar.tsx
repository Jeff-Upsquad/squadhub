import type { CSSProperties } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarPerson {
  id?: string;
  name?: string;
  display_name?: string;
  email?: string;
  avatar_url?: string | null;
  initials?: string;
  hue?: number;
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function initialsFor(person: AvatarPerson): string {
  if (person.initials) return person.initials.slice(0, 2).toUpperCase();
  const name = person.display_name || person.name || person.email || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Avatar({
  person,
  size = 'sm',
  showName = false,
}: {
  person: AvatarPerson;
  size?: AvatarSize;
  showName?: boolean;
}) {
  const name = person.display_name || person.name || '';
  const initials = initialsFor(person);
  const hue = person.hue ?? hueFromString(person.id || name || initials);
  const bg = `hsl(${hue}, 60%, 78%)`;
  const style: CSSProperties = { background: bg };

  if (person.avatar_url) {
    style.backgroundImage = `url(${person.avatar_url})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      title={name || initials}
    >
      <span className={`cd-avatar ${size}`} style={style}>
        {!person.avatar_url && initials}
      </span>
      {showName && name && <span style={{ fontSize: 12.5 }}>{name}</span>}
    </span>
  );
}
