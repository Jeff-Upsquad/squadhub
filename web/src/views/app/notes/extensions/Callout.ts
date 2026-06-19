import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import CalloutView from '../nodeviews/CalloutView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      toggleCallout: () => ReturnType;
    };
  }
}

// Highlighted callout block (Notion-style). Holds block content (paragraphs,
// lists, etc.) inside a tinted container with an emoji gutter.
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return { emoji: { default: '💡' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout: (attrs) => ({ commands }) => commands.wrapIn('callout', attrs),
      toggleCallout: () => ({ commands }) => commands.toggleWrap('callout'),
    };
  },
});
