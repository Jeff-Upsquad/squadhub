export type UrlPasteKind = 'link' | 'bookmark' | 'embed';

interface Props {
  x: number;
  y: number;
  onPick: (kind: UrlPasteKind) => void;
}

// The small inline menu shown right after pasting a bare URL.
export default function UrlPasteChooser({ x, y, onPick }: Props) {
  const opt = (kind: UrlPasteKind, icon: string, label: string, sub: string) => (
    <button
      type="button"
      className="sh-url-chooser__opt"
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(kind);
      }}
    >
      <span className="sh-url-chooser__icon">{icon}</span>
      <span className="sh-url-chooser__text">
        <span className="sh-url-chooser__label">{label}</span>
        <span className="sh-url-chooser__sub">{sub}</span>
      </span>
    </button>
  );

  return (
    <div className="sh-url-chooser" style={{ position: 'fixed', left: x, top: y, zIndex: 70 }}>
      {opt('link', '🔗', 'Link', 'Keep as a text link')}
      {opt('bookmark', '🔖', 'Bookmark', 'Show a rich preview card')}
      {opt('embed', '🎞', 'Embed', 'Play / embed inline')}
    </div>
  );
}
