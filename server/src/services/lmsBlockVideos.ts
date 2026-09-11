import { supabaseAdmin } from '../supabase';

/**
 * Load the per-language video alternates for a set of content blocks.
 *
 * Only video blocks can have them, so non-video blocks are filtered out before
 * the query rather than fetching rows that can't exist. Blocks with no
 * alternates are simply absent from the map — callers leave those untouched so
 * a single-language block keeps the exact shape it had before this feature.
 */
export async function loadBlockVideos(
  blocks: readonly { id: string; type: string }[],
): Promise<Map<string, any[]>> {
  const videoBlockIds = blocks
    .filter((b) => b.type === 'video_embed' || b.type === 'video_upload')
    .map((b) => b.id);

  const byBlock = new Map<string, any[]>();
  if (videoBlockIds.length === 0) return byBlock;

  const { data } = await supabaseAdmin
    .from('lms_content_block_videos')
    .select('*')
    .in('block_id', videoBlockIds)
    .order('language', { ascending: true });

  for (const row of data ?? []) {
    const list = byBlock.get((row as any).block_id) ?? [];
    list.push(row);
    byBlock.set((row as any).block_id, list);
  }
  return byBlock;
}

/** Attach `videos` to a block when it has alternates; otherwise pass it through. */
export function withBlockVideos<T extends { id: string }>(
  block: T,
  byBlock: Map<string, any[]>,
): T | (T & { videos: any[] }) {
  const videos = byBlock.get(block.id);
  return videos && videos.length > 0 ? { ...block, videos } : block;
}
