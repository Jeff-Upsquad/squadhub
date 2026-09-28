import { Router, Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { botChannel, doubtSchema, getOrCreateBotUser } from '../../services/squadBotChannels';
import { allPaused, effectiveStatus, type SquadBotRow } from '../../services/squadBots';
import { jobBlockReason, listJobs } from '../../services/squadBotJobs';

type BotRequest = Request & { squadBot?: SquadBotRow };
const router = Router();
const fail = (res: any, e: unknown) => res.status(e instanceof z.ZodError ? 400 : 500).json({ error: e instanceof z.ZodError ? e.errors[0].message : 'Could not process bot question' });
router.post('/doubts', async (req: BotRequest, res) => {
  try {
    const body = doubtSchema.parse(req.body), bot = req.squadBot!;
    const channel = await botChannel(bot.id);
    if (!channel) { res.status(409).json({ error: 'Set up the bot channel in admin first' }); return; }
    const jobs = await listJobs(bot.id);
    if ((jobs.length || body.job_id) && !jobs.some(j => j.id === body.job_id)) { res.status(400).json({ error: 'Choose a job belonging to this bot' }); return; }
    // A stable event_id makes retries return the original question, including
    // its decision. Retrying must never overwrite a human response.
    const insert = await supabaseAdmin.from('squad_bot_doubts').upsert({ ...body, bot_id: bot.id }, { onConflict: 'bot_id,event_id', ignoreDuplicates: true });
    if (insert.error) throw insert.error;
    const { data, error } = await supabaseAdmin.from('squad_bot_doubts').select('*').eq('bot_id', bot.id).eq('event_id', body.event_id).single();
    if (error) throw error;

    // Post as a normal message in the bot's channel so the team sees it in the feed
    try {
      const { data: existingMsg } = await supabaseAdmin
        .from('messages')
        .select('id')
        .eq('channel_id', channel.id)
        .contains('metadata', { doubt_id: data.id })
        .maybeSingle();

      if (!existingMsg) {
        const botUser = await getOrCreateBotUser(bot, channel.workspace_id);
        const { data: newMsg } = await supabaseAdmin
          .from('messages')
          .insert({
            channel_id: channel.id,
            sender_id: botUser.id,
            content: body.question,
            type: 'text',
            metadata: {
              kind: 'bot_doubt',
              doubt_id: data.id,
              bot_id: bot.id,
              question: body.question,
              context: body.context,
              source_url: body.source_url,
              status: data.status,
            },
          })
          .select('*, sender:users!sender_id(id, display_name, avatar_url)')
          .single();

        const io = req.app.get('io');
        if (io && newMsg) {
          io.to(channel.id).emit('new_message', newMsg);
        }
      }
    } catch (msgErr) {
      console.error('[squad-bot-doubts] could not post channel message for doubt:', msgErr);
    }

    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
router.get('/doubts', async (req: BotRequest, res) => {
  try {
    const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
    const status = z.enum(['open','instructed','executing','taken_over','completed','failed']).optional().parse(req.query.status);
    let query = supabaseAdmin.from('squad_bot_doubts').select('*').eq('bot_id', req.squadBot!.id);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at').order('id').range(page * 100, page * 100 + 99);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
router.get('/doubts/:id', async (req: BotRequest, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { data, error } = await supabaseAdmin.from('squad_bot_doubts').select('*').eq('bot_id', req.squadBot!.id).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Question not found' }); return; }
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
// Explicit user instruction authorizes a held approval-mode action. Practice
// and emergency stop still block it. A CAS claim allows only one worker.
router.post('/doubts/:id/claim', async (req: BotRequest, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id), bot = req.squadBot!;
    const { data: doubt, error } = await supabaseAdmin.from('squad_bot_doubts').select('*').eq('id', id).eq('bot_id', bot.id).maybeSingle();
    if (error) throw error;
    if (!doubt) { res.status(404).json({ error: 'Question not found' }); return; }
    const status = effectiveStatus(bot, await allPaused());
    if (status === 'off' || status === 'practice') { res.status(423).json({ error: 'This bot cannot execute actions in its current mode' }); return; }
    const jobs = await listJobs(bot.id), job = jobs.find(j => j.id === doubt.job_id);
    if ((jobs.length || doubt.job_id) && (!job || jobBlockReason(job, status, doubt.target))) {
      res.status(423).json({ error: 'The job is paused or the target is outside its scope' }); return;
    }
    const { data, error: claimError } = await supabaseAdmin.from('squad_bot_doubts')
      .update({ status: 'executing', execution_token: randomUUID() }).eq('id', id).eq('bot_id', bot.id).eq('status', 'instructed').select('*').maybeSingle();
    if (claimError) throw claimError;
    if (!data) { res.status(409).json({ error: 'This action is already claimed, handled, or awaiting guidance' }); return; }
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
router.post('/doubts/:id/outcome', async (req: BotRequest, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ execution_token: z.string().uuid(), status: z.enum(['completed','failed']), note: z.string().trim().min(1).max(4000) }).parse(req.body);
    const { data, error } = await supabaseAdmin.from('squad_bot_doubts').update({ status: body.status, outcome_note: body.note })
      .eq('id', id).eq('bot_id', req.squadBot!.id).eq('execution_token', body.execution_token).eq('status', 'executing').select('*').maybeSingle();
    if (error) throw error;
    if (!data) {
      const previous = await supabaseAdmin.from('squad_bot_doubts').select('*').eq('id', id).eq('bot_id', req.squadBot!.id).eq('execution_token', body.execution_token).maybeSingle();
      if (previous.error) throw previous.error;
      if (previous.data?.status === body.status && previous.data.outcome_note === body.note) { res.json({ success: true, data: previous.data }); return; }
      res.status(409).json({ error: 'No matching executing action' }); return;
    }
    // Post outcome reply into the thread so the team sees the result
    try {
      const { data: parentMsg } = await supabaseAdmin
        .from('messages')
        .select('id, channel_id, metadata')
        .contains('metadata', { doubt_id: id })
        .maybeSingle();

      if (parentMsg) {
        const channel = await botChannel(req.squadBot!.id);
        const botUser = await getOrCreateBotUser(req.squadBot!, channel?.workspace_id || '');
        const replyText = body.status === 'completed'
          ? `✅ Done! ${body.note || 'Reply sent to candidate.'}`
          : `⚠️ Action failed: ${body.note || 'Unable to complete action.'}`;

        const { data: threadReply } = await supabaseAdmin
          .from('messages')
          .insert({
            channel_id: parentMsg.channel_id,
            parent_message_id: parentMsg.id,
            sender_id: botUser.id,
            content: replyText,
            type: 'text',
          })
          .select('*, sender:users!sender_id(id, display_name, avatar_url)')
          .single();
        if (threadReply) {
          await supabaseAdmin.from('message_threads').insert({
            parent_message_id: parentMsg.id,
            reply_message_id: threadReply.id,
          });
        }

        // Update parent message metadata status
        const { data: updatedParent } = await supabaseAdmin
          .from('messages')
          .update({
            metadata: {
              ...(parentMsg as any).metadata,
              status: body.status,
              outcome_note: body.note,
            },
          })
          .eq('id', parentMsg.id)
          .select('*, sender:users!sender_id(id, display_name, avatar_url)')
          .single();

        const io = req.app.get('io');
        if (io) {
          if (updatedParent) {
            io.to(parentMsg.channel_id).emit('message_updated', updatedParent);
          }
          if (threadReply) {
            io.to(parentMsg.channel_id).emit('new_message', threadReply);
            io.to(parentMsg.channel_id).emit('thread_reply', threadReply);
          }
        }
      }
    } catch (err) {
      console.error('[squad-bot-doubts] could not post thread outcome reply:', err);
    }

    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
router.get('/learnings', async (req: BotRequest, res) => {
  try {
    const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
    const { data, error } = await supabaseAdmin.from('squad_bot_learnings').select('id,question,instruction,created_at')
      .eq('bot_id', req.squadBot!.id).order('created_at').order('id').range(page * 100, page * 100 + 99);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { fail(res, e); }
});
export default router;
