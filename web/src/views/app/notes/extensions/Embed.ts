import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import EmbedView from '../nodeviews/EmbedView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (attrs: { url: string }) => ReturnType;
    };
  }
}

// A playable embed: SquadClips → chrome-free iframe; YouTube/Vimeo/media →
// ReactPlayer. The node view decides how to render based on the URL.
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { url: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      setEmbed: (attrs) => ({ commands }) => commands.insertContent({ type: 'embed', attrs }),
    };
  },
});
