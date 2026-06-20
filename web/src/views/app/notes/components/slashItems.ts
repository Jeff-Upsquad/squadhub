import type { Editor } from '@tiptap/core';

// Interactive slash actions handled by NoteEditor (need React/upload/navigation).
export type SlashAction = 'subpage' | 'image' | 'video' | 'audio' | 'file' | 'embed' | 'bookmark';
export type SlashRun = (action: SlashAction, editor: Editor) => void;

export interface SlashItem {
  title: string;
  subtitle: string;
  icon: string;
  keywords: string;
  group: 'Basic' | 'Media' | 'Pages';
  run: (editor: Editor) => void;
}

export function buildSlashItems(run: SlashRun): SlashItem[] {
  return [
    { title: 'Text', subtitle: 'Plain paragraph', icon: '¶', keywords: 'text paragraph body', group: 'Basic',
      run: (e) => e.chain().focus().setParagraph().run() },
    { title: 'Heading 1', subtitle: 'Big section heading', icon: 'H1', keywords: 'h1 title large', group: 'Basic',
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { title: 'Heading 2', subtitle: 'Medium section heading', icon: 'H2', keywords: 'h2 subtitle', group: 'Basic',
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { title: 'Heading 3', subtitle: 'Small section heading', icon: 'H3', keywords: 'h3', group: 'Basic',
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { title: 'Bulleted list', subtitle: 'A simple bullet list', icon: '•', keywords: 'ul unordered bullet', group: 'Basic',
      run: (e) => e.chain().focus().toggleBulletList().run() },
    { title: 'Numbered list', subtitle: 'A numbered list', icon: '1.', keywords: 'ol ordered number', group: 'Basic',
      run: (e) => e.chain().focus().toggleOrderedList().run() },
    { title: 'To-do list', subtitle: 'Track tasks with checkboxes', icon: '☑', keywords: 'todo task checkbox check', group: 'Basic',
      run: (e) => e.chain().focus().toggleTaskList().run() },
    { title: 'Divider', subtitle: 'Visually separate sections', icon: '—', keywords: 'hr rule line separator', group: 'Basic',
      run: (e) => e.chain().focus().setHorizontalRule().run() },
    { title: 'Callout', subtitle: 'Highlighted call-out box', icon: '💡', keywords: 'callout highlight note info box', group: 'Basic',
      run: (e) => e.chain().focus().setCallout().run() },
    { title: 'Quote', subtitle: 'Capture a quotation', icon: '❝', keywords: 'quote blockquote', group: 'Basic',
      run: (e) => e.chain().focus().toggleBlockquote().run() },
    { title: 'Code', subtitle: 'Code block', icon: '</>', keywords: 'code pre snippet', group: 'Basic',
      run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { title: 'Sub-page', subtitle: 'Create a page inside this page', icon: '📄', keywords: 'page subpage child new', group: 'Pages',
      run: (e) => run('subpage', e) },
    { title: 'Image', subtitle: 'Upload an image', icon: '🖼', keywords: 'image photo picture upload', group: 'Media',
      run: (e) => run('image', e) },
    { title: 'Video', subtitle: 'Upload a video', icon: '🎬', keywords: 'video movie mp4 upload', group: 'Media',
      run: (e) => run('video', e) },
    { title: 'Audio', subtitle: 'Upload audio', icon: '🔊', keywords: 'audio sound voice upload', group: 'Media',
      run: (e) => run('audio', e) },
    { title: 'File', subtitle: 'Upload a document', icon: '📎', keywords: 'file document pdf doc upload attach', group: 'Media',
      run: (e) => run('file', e) },
    { title: 'Embed', subtitle: 'Embed a video / clip', icon: '🎞', keywords: 'embed iframe youtube vimeo clip squadclips', group: 'Media',
      run: (e) => run('embed', e) },
    { title: 'Bookmark', subtitle: 'Save a link as a card', icon: '🔖', keywords: 'bookmark link card url', group: 'Media',
      run: (e) => run('bookmark', e) },
  ];
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((i) => `${i.title} ${i.keywords}`.toLowerCase().includes(q));
}
