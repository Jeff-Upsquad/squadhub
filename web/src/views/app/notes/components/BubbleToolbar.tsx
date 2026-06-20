import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';

const HIGHLIGHTS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'];

export default function BubbleToolbar({ editor }: { editor: Editor }) {
  const btn = (key: string, active: boolean, onClick: () => void, label: React.ReactNode, title: string) => (
    <button
      key={key}
      type="button"
      title={title}
      className={`sh-note-bubble__btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className="sh-note-bubble"
      shouldShow={({ editor: ed, from, to }) => {
        if (from === to) return false;
        if (!ed.isEditable) return false;
        const sel = ed.state.selection as { node?: { isAtom?: boolean } };
        if (sel.node?.isAtom) return false;
        return true;
      }}
    >
      {btn('bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <strong>B</strong>, 'Bold')}
      {btn('italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <em>i</em>, 'Italic')}
      {btn('underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <span style={{ textDecoration: 'underline' }}>U</span>, 'Underline')}
      {btn('strike', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <s>S</s>, 'Strikethrough')}
      {btn('code', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <span style={{ fontFamily: 'monospace' }}>{'</>'}</span>, 'Inline code')}
      <span className="sh-note-bubble__sep" />
      {btn(
        'link',
        editor.isActive('link'),
        () => {
          const prev = (editor.getAttributes('link').href as string) || '';
          const url = window.prompt('Link URL', prev);
          if (url === null) return;
          if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        },
        '🔗',
        'Link',
      )}
      <span className="sh-note-bubble__sep" />
      {HIGHLIGHTS.map((color) =>
        btn(
          `hl-${color}`,
          editor.isActive('highlight', { color }),
          () => editor.chain().focus().toggleHighlight({ color }).run(),
          <span className="sh-note-bubble__swatch" style={{ background: color }} />,
          'Highlight',
        ),
      )}
      {btn('clear-hl', false, () => editor.chain().focus().unsetHighlight().run(), '⊘', 'Clear highlight')}
    </BubbleMenu>
  );
}
