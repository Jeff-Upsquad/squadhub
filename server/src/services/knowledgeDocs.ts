import { supabaseAdmin } from '../supabase';

export interface KnowledgeDocBot {
  id: string;
  internal_name: string;
  home_app: string;
}

/** Batched read for both the library and a single doc's sharing picker. */
export async function knowledgeDocBots(itemIds: string[]): Promise<Map<string, KnowledgeDocBot[]>> {
  const result = new Map<string, KnowledgeDocBot[]>();
  if (!itemIds.length) return result;
  const { data, error } = await supabaseAdmin.from('squad_bot_knowledge_docs')
    .select('item_id, bot:squad_bots(id, internal_name, home_app)').in('item_id', itemIds);
  if (error) throw new Error(error.message);
  for (const link of data ?? []) {
    const bot = link.bot as unknown as KnowledgeDocBot | null;
    if (bot) result.set(link.item_id, [...(result.get(link.item_id) ?? []), bot]);
  }
  return result;
}

export async function knowledgeDocUsesSquadhire(itemId: string): Promise<boolean> {
  const bots = (await knowledgeDocBots([itemId])).get(itemId) ?? [];
  return bots.some((bot) => bot.home_app === 'squadhire');
}
