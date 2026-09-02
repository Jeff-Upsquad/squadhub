'use client';
// Shared Tiptap schema + helpers for the Notion-style page editor and the
// read-only reader, so anything authored (headings, lists, images, video
// embeds, callouts) renders identically in both places.
import { Node, mergeAttributes, Extension, type Editor, type Range } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import Suggestion from '@tiptap/suggestion';
import { getFreshAccessToken } from '../../../../services/api';
import { useAuthStore } from '../../../../stores/authStore';

const CLIPS_ORIGIN = (process.env.NEXT_PUBLIC_CLIPS_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://clips.squadhub.in' : 'http://localhost:3200'));

function clipEmbedSrc(rawUrl: string): { src: string; gated: boolean } | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const isClipsHost =
    u.hostname === 'clips.squadhub.in' ||
    ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
  if (!isClipsHost) return null;
  const lms = u.pathname.match(/^\/(?:share|embed)\/lms\/([A-Za-z0-9_-]+)\/?$/);
  if (lms) return { src: `${u.origin}/embed/lms/${lms[1]}`, gated: true };
  const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? { src: `${u.origin}/embed/${m[1]}`, gated: false } : null;
}

/* ---- Video / rich embed node (YouTube, Vimeo, Loom, …) ---- */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      provider: { default: 'embed' },
    };
  },
  parseHTML() {
    return [{
      tag: 'div[data-embed]',
      getAttrs: (el) => ({
        src: (el as HTMLElement).getAttribute('data-src'),
        provider: (el as HTMLElement).getAttribute('data-provider') || 'embed',
      }),
    }];
  },
  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src as string;
    return [
      'div',
      mergeAttributes({ 'data-embed': '', class: 'lms-embed', 'data-src': src, 'data-provider': HTMLAttributes.provider }),
      ['iframe', { src, allowfullscreen: 'true', allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture' }],
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'lms-embed';
      dom.contentEditable = 'false';
      dom.setAttribute('data-embed', '');
      const iframe = document.createElement('iframe');
      const rawSrc = (node.attrs.src as string) || '';
      const clip = rawSrc ? clipEmbedSrc(rawSrc) : null;
      if (clip) {
        iframe.src = clip.src;
      } else if (rawSrc) {
        iframe.src = rawSrc;
      }
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');

      let cleanup: (() => void) | null = null;
      if (clip) {
        const sendAuth = async () => {
          const token = await getFreshAccessToken();
          const { user } = useAuthStore.getState();
          if (!token || !user || !iframe.contentWindow) return;
          iframe.contentWindow.postMessage(
            { type: 'squadclips:auth', accessToken: token, user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url } },
            CLIPS_ORIGIN,
          );
        };
        const onMessage = (e: MessageEvent) => {
          if (e.origin !== CLIPS_ORIGIN || e.source !== iframe.contentWindow) return;
          if (e.data?.type === 'squadclips:ready' || e.data?.type === 'squadclips:request-token') {
            void sendAuth();
          }
        };
        window.addEventListener('message', onMessage);
        iframe.addEventListener('load', () => { if (clip.gated) void sendAuth(); });
        cleanup = () => window.removeEventListener('message', onMessage);
      }

      dom.appendChild(iframe);
      return { dom, destroy: () => cleanup?.() };
    };
  },
});

/* ---- URL → embeddable src ---- */
export function toEmbedSrc(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return u.href;
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host.endsWith('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
    if (host.endsWith('loom.com')) return u.href.replace('/share/', '/embed/');
    return u.href;
  } catch {
    return url;
  }
}
export function providerOf(url: string): string {
  if (/youtu/.test(url)) return 'youtube';
  if (/vimeo/.test(url)) return 'vimeo';
  if (/loom/.test(url)) return 'loom';
  return 'embed';
}

/* ---- Extension set shared by editor + reader ---- */
export function sharedExtensions(opts?: { placeholder?: string }) {
  const list: any[] = [
    StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
    Link.configure({ openOnClick: true }),
    Image.configure({ inline: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Embed,
  ];
  if (opts?.placeholder) {
    list.push(Placeholder.configure({ placeholder: opts.placeholder, showOnlyWhenEditable: true }));
  }
  return list;
}

/* ---- Slash command menu (the "/" inserter) ---- */
export interface SlashItem {
  title: string;
  desc?: string;
  icon: string;
  keywords?: string;
  action: (editor: Editor, range: Range) => void;
}

function slashRenderer() {
  let el: HTMLDivElement | null = null;
  let items: SlashItem[] = [];
  let selected = 0;
  let pick: (i: SlashItem) => void = () => {};

  const paint = () => {
    if (!el) return;
    el.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lms-slash-empty';
      empty.textContent = 'No matches';
      el.appendChild(empty);
      return;
    }
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lms-slash-item' + (i === selected ? ' is-sel' : '');
      b.innerHTML = `<span class="ic">${it.icon}</span><span class="tx"><span class="t">${it.title}</span>${it.desc ? `<span class="d">${it.desc}</span>` : ''}</span>`;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
      b.addEventListener('mouseenter', () => { selected = i; paint(); });
      el!.appendChild(b);
    });
  };
  const place = (rect: DOMRect | null | undefined) => {
    if (!el || !rect) return;
    const menuH = Math.min(340, items.length * 46 + 12);
    const below = rect.bottom + 6;
    const above = rect.top - menuH - 6;
    const top = (below + menuH > window.innerHeight && above > 0) ? above : below;
    el.style.top = `${Math.max(8, top)}px`;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 292)}px`;
  };

  return {
    onStart: (props: any) => {
      items = props.items; selected = 0;
      pick = (it: SlashItem) => props.command(it);
      el = document.createElement('div');
      el.className = 'lms-slash-menu';
      document.body.appendChild(el);
      paint();
      place(props.clientRect?.());
    },
    onUpdate: (props: any) => {
      items = props.items; selected = 0;
      pick = (it: SlashItem) => props.command(it);
      paint();
      place(props.clientRect?.());
    },
    onKeyDown: (props: any) => {
      const k = props.event.key;
      if (k === 'ArrowDown') { selected = (selected + 1) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'ArrowUp') { selected = (selected - 1 + items.length) % Math.max(items.length, 1); paint(); return true; }
      if (k === 'Enter') { if (items[selected]) pick(items[selected]); return true; }
      if (k === 'Escape') { el?.remove(); el = null; return true; }
      return false;
    },
    onExit: () => { el?.remove(); el = null; },
  };
}

export function SlashCommand(getItems: () => SlashItem[]) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          command: ({ editor, range, props }) => props.action(editor, range),
          items: ({ query }) => {
            const q = query.toLowerCase();
            return getItems().filter(
              (i) => i.title.toLowerCase().includes(q) || (i.keywords || '').toLowerCase().includes(q),
            ).slice(0, 10);
          },
          render: slashRenderer,
        }),
      ];
    },
  });
}
