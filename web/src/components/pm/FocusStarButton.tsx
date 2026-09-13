'use client';

import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';

type FocusStarVariant = 'list' | 'panel' | 'mobile';

export default function FocusStarButton({
  active,
  onToggle,
  variant,
  className = '',
  stopPropagation = false,
}: {
  active: boolean;
  onToggle: (focused: boolean) => void;
  variant: FocusStarVariant;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [motion, setMotion] = useState<{ key: number; direction: 'on' | 'off' } | null>(null);
  const label = active ? 'Remove from Focus Today' : 'Add to Focus Today';

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) event.stopPropagation();
    setMotion((previous) => ({
      key: (previous?.key ?? 0) + 1,
      direction: active ? 'off' : 'on',
    }));
    onToggle(!active);
  };

  return (
    <button
      type="button"
      className={`focus-star-button ${className}`.trim()}
      data-active={active}
      data-on={active ? 'true' : undefined}
      data-focus-variant={variant}
      data-focus-motion={motion?.direction}
      onClick={handleClick}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
      }}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <span key={`glyph-${motion?.key ?? 0}`} className="focus-star-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.8l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.8 6.6 19.6l1-6.1L3.2 9.2l6.1-.9z" />
        </svg>
      </span>
      {motion?.direction === 'on' && (
        <span key={`burst-${motion.key}`} className="focus-star-burst" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} style={{ '--focus-star-ray': `${index * 45}deg`, '--focus-star-delay': `${index * 12}ms` } as CSSProperties} />
          ))}
        </span>
      )}
    </button>
  );
}
