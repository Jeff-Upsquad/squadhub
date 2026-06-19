// SquadClips share/embed links (clips.squadhub.in/share|embed/<token>) point at
// a branded watch page that ReactPlayer can't play. For recognized clip links,
// return the chrome-free /embed/<token> URL to render in an iframe instead. The
// host allow-list keeps arbitrary pasted URLs from becoming iframe sources.
// Mirrors clipEmbedSrc in learning/blocks/VideoEmbedBlock.tsx.
export function clipEmbedSrc(rawUrl: string): string | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const isClipsHost =
    u.hostname === 'clips.squadhub.in' ||
    ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
  if (!isClipsHost) return null;
  const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? `${u.origin}/embed/${m[1]}` : null;
}

export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
