import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import BookmarkView from '../nodeviews/BookmarkView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (attrs: { url: string }) => ReturnType;
    };
  }
}

// A rich link "card" (favicon + title + description + thumbnail). Metadata is
// fetched once via /notes/unfurl and cached into the node attrs so it survives
// reopening the doc and the source going away.
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: null },
      description: { default: null },
      image: { default: null },
      favicon: { default: null },
      site_name: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-bookmark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-bookmark': '', href: HTMLAttributes.url || '#' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },

  addCommands() {
    return {
      setBookmark: (attrs) => ({ commands }) => commands.insertContent({ type: 'bookmark', attrs }),
    };
  },
});
