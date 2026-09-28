import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { safeActivityUrl, targetSchema } from './squadBotJobs';

export const doubtSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(4000),
  context: z.string().trim().max(12000).default(''),
  source_url: z.string().max(2000).refine(safeActivityUrl, 'Use an HTTPS URL or a site-relative path'),
  job_id: z.string().uuid().optional(),
  target: targetSchema.default({}),
});
export const decisionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('instruct'), instruction: z.string().trim().min(1).max(4000) }),
  z.object({ mode: z.literal('takeover') }),
]);

export async function botChannel(botId: string) {
  const { data, error } = await supabaseAdmin.from('channels').select('*').eq('squad_bot_id', botId).is('deleted_at', null).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
export async function ensureBotChannel(botId: string, workspaceId: string, userId: string) {
  const { data, error } = await supabaseAdmin.rpc('ensure_squad_bot_channel', { p_bot_id: botId, p_workspace_id: workspaceId, p_user_id: userId });
  if (error) throw new Error(error.message);
  return data;
}
export async function learnedGuidance(botId: string, limit = 50) {
  const { data, error } = await supabaseAdmin.from('squad_bot_learnings')
    .select('id, question, instruction, created_at').eq('bot_id', botId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Invitations must stay within the channel's internal workspace users. */
export async function eligibleBotChannelMember(channelId: string, userId: string): Promise<boolean> {
  const { data: channel, error } = await supabaseAdmin.from('channels').select('workspace_id, squad_bot_id').eq('id', channelId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!channel?.squad_bot_id) return true;
  const [user, membership] = await Promise.all([
    supabaseAdmin.from('users').select('user_type, status').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('workspace_members').select('user_id').eq('workspace_id', channel.workspace_id).eq('user_id', userId).maybeSingle(),
  ]);
  if (user.error || membership.error) throw new Error('Could not verify channel membership');
  return !!membership.data && user.data?.user_type === 'internal' && !['banned', 'suspended'].includes(user.data.status);
}

/** Keep the additional prompt bounded while preserving complete Q&A pairs. */
export function guidanceContext(rows: Array<{ question: string; instruction: string }>): string {
  const parts: string[] = [];
  let remaining = 24000;
  for (const row of rows) {
    const part = `Question: ${row.question}\nGuidance: ${row.instruction}`;
    if (part.length > remaining) continue;
    parts.push(part);
    remaining -= part.length + 2;
  }
  return parts.length ? 'Guidance saved by your internal team (apply when relevant):\n' + parts.join('\n\n') : '';
}

/** Get or provision the internal user record representing a squad bot. */
export async function getOrCreateBotUser(
  bot: { id: string; slug: string; internal_name: string; public_name?: string },
  workspaceId: string,
): Promise<{ id: string; display_name: string; avatar_url?: string | null }> {
  const email = `bot-${bot.slug}@squadbots.internal`;
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url')
    .eq('email', email)
    .maybeSingle();

  let botUser = existing;
  if (!botUser) {
    const { data: created, error } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        display_name: bot.public_name || bot.internal_name,
        user_type: 'internal',
        is_admin: false,
      })
      .select('id, display_name, avatar_url')
      .single();
    if (error || !created) throw new Error(error?.message || 'Failed to create bot user');
    botUser = created;
  }

  // Ensure membership in the workspace so channel and message checks succeed
  const { data: wm } = await supabaseAdmin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', botUser.id)
    .maybeSingle();
  if (!wm) {
    try {
      await supabaseAdmin
        .from('workspace_members')
        .insert({ workspace_id: workspaceId, user_id: botUser.id, role: 'member' });
    } catch {
      // Ignore conflict
    }
  }

  return botUser;
}

