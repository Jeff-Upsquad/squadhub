import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { SlashItem } from './slashItems';

export interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

const SlashMenu = forwardRef<SlashMenuHandle, Props>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [items]);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.sh-slash-item.is-active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false;
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const it = items[selected];
          if (it) command(it);
          return true;
        }
        return false;
      },
    }),
    [items, selected, command],
  );

  if (!items.length) {
    return <div className="sh-slash-menu sh-slash-menu--empty">No matches</div>;
  }

  return (
    <div className="sh-slash-menu" ref={listRef}>
      {items.map((it, i) => (
        <button
          key={it.title}
          type="button"
          className={`sh-slash-item${i === selected ? ' is-active' : ''}`}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            command(it);
          }}
        >
          <span className="sh-slash-item__icon">{it.icon}</span>
          <span className="sh-slash-item__text">
            <span className="sh-slash-item__title">{it.title}</span>
            <span className="sh-slash-item__sub">{it.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';
export default SlashMenu;
