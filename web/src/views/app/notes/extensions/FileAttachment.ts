import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import FileAttachmentView from '../nodeviews/FileAttachmentView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      setFileAttachment: (attrs: {
        url: string;
        name?: string;
        size?: number;
        mime?: string;
        category?: 'audio' | 'video' | 'file';
      }) => ReturnType;
    };
  }
}

// An uploaded audio / video / document. The node view renders an <audio>
// player, a ReactPlayer video, or a download card based on `category`.
export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      name: { default: 'file' },
      size: { default: 0 },
      mime: { default: '' },
      category: { default: 'file' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },

  addCommands() {
    return {
      setFileAttachment: (attrs) => ({ commands }) => commands.insertContent({ type: 'fileAttachment', attrs }),
    };
  },
});
