import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import SlashMenu, { type SlashMenuHandle } from '../components/SlashMenu';
import { buildSlashItems, filterSlashItems, type SlashItem, type SlashRun } from '../components/slashItems';

export interface SlashCommandOptions {
  run: SlashRun;
}

// "/" command menu. Uses @tiptap/suggestion's managed mount (floating-ui) to
// position the React menu, so no extra positioning lib is needed.
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { run: () => {} };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => filterSlashItems(buildSlashItems(options.run), query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle> | null = null;
          let el: HTMLElement | null = null;

          const place = (props: { clientRect?: (() => DOMRect | null) | null }) => {
            const rect = props.clientRect?.();
            if (!rect || !el) return;
            el.style.position = 'fixed';
            el.style.zIndex = '90';
            el.style.left = `${rect.left}px`;
            const height = el.offsetHeight || 320;
            const below = rect.bottom + 4;
            // Flip above the caret when there isn't room below.
            el.style.top = below + height > window.innerHeight ? `${rect.top - height - 4}px` : `${below}px`;
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              el = component.element as HTMLElement;
              document.body.appendChild(el);
              place(props);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
              place(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') return true;
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              el?.remove();
              component?.destroy();
              component = null;
              el = null;
            },
          };
        },
      }),
    ];
  },
});
