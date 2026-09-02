// SquadClips share/embed links (clips.squadhub.in/share|embed/<token>) point at
// a branded watch page that ReactPlayer can't play. For recognized clip links,
// return the chrome-free /embed/<token> URL to render in an iframe instead. The
// host allow-list keeps arbitrary pasted URLs from becoming iframe sources.
// Mirrors clipEmbedSrc in learning/blocks/VideoEmbedBlock.tsx.
export function clipEmbedSrc(rawUrl: string): { src: string; gated: boolean } | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  const isClipsHost =
    u.hostname === 'clips.squadhub.in' ||
    ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
  if (!isClipsHost) return null;
  // Login-gated: /share|/embed/lms/<token>
  const lms = u.pathname.match(/^\/(?:share|embed)\/lms\/([A-Za-z0-9_-]+)\/?$/);
  if (lms) return { src: `${u.origin}/embed/lms/${lms[1]}`, gated: true };
  // Public share/embed token.
  const m = u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/);
  return m ? { src: `${u.origin}/embed/${m[1]}`, gated: false } : null;
}

export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
