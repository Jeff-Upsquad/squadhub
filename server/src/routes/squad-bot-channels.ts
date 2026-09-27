import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import { decisionSchema } from '../services/squadBotChannels';

const router = Router();
router.use(requireAuth);
// A dedicated API inside normal chat: channel membership is the authority,
// and an internal account is required even for workspace-wide administrators.
async function access(req: Request, res: Response, write = false) {
  const id = z.string().uuid().safeParse(req.params.channelId);
  if (!id.success) { res.status(400).json({ error: 'Invalid channel' }); return null; }
  if (req.userType !== 'internal') { res.status(403).json({ error: 'Internal users only' }); return null; }
  const level = await checkResourceAccess(req.userId!, 'channel', id.data);
  if (!level || (write && !meetsAccessLevel(level, 'commenter'))) {
    res.status(403).json({ error: 'Channel access required' }); return null;
  }
  const { data, error } = await supabaseAdmin.from('channels').select('id, squad_bot_id').eq('id', id.data).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!data?.squad_bot_id) { res.status(404).json({ error: 'Bot channel not found' }); return null; }
  return { ...data, can_respond: meetsAccessLevel(level, 'commenter'), can_invite: meetsAccessLevel(level, 'manager') };
}
router.get('/:channelId/doubts', async (req, res) => {
  try {
    const channel = await access(req, res); if (!channel) return;
    const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
    const { data, error, count } = await supabaseAdmin.from('squad_bot_doubts').select('*', { count: 'exact' })
      .eq('bot_id', channel.squad_bot_id).order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24);
    if (error) throw error;
    res.json({ success: true, data: { questions: data, total: count, can_respond: channel.can_respond, can_invite: channel.can_invite } });
  } catch (e) { res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not load bot questions' }); }
});
router.post('/:channelId/doubts/:doubtId/resolve', async (req, res) => {
  try {
    const channel = await access(req, res, true); if (!channel) return;
    const id = z.string().uuid().parse(req.params.doubtId);
    const decision = decisionSchema.parse(req.body);
    const { data, error } = await supabaseAdmin.rpc('resolve_squad_bot_doubt', {
      p_id: id, p_bot_id: channel.squad_bot_id, p_user_id: req.userId,
      p_mode: decision.mode, p_instruction: decision.mode === 'instruct' ? decision.instruction : null,
    });
    if (error) {
      if (error.code === 'P0001' || error.code === 'P0002') { res.status(409).json({ error: 'This question has already changed. Refresh and try again.' }); return; }
      throw error;
    }
    res.json({ success: true, data });
  } catch (e) { res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not save the response' }); }
});
export default router;
