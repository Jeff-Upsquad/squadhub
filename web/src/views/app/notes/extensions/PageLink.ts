import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import PageLinkView from '../nodeviews/PageLinkView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      insertPageLink: (attrs: { pageId: string; title?: string; icon?: string | null }) => ReturnType;
    };
  }
}

// A clickable link to a child page, rendered inline in the parent doc. Clicking
// navigates the notes view to that page (state-driven, no router).
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      pageId: { default: '' },
      title: { default: 'Untitled' },
      icon: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-page-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-link': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },

  addCommands() {
    return {
      insertPageLink: (attrs) => ({ commands }) => commands.insertContent({ type: 'pageLink', attrs }),
    };
  },
});
