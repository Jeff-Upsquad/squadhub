import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';
import { decisionSchema, getOrCreateBotUser } from '../services/squadBotChannels';

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
  const { data, error } = await supabaseAdmin.from('channels').select('id, squad_bot_id, workspace_id').eq('id', id.data).is('deleted_at', null).maybeSingle();
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

    // Update the parent message metadata and post a notice in the thread if takeover
    try {
      const { data: parentMsg } = await supabaseAdmin
        .from('messages')
        .select('id, channel_id, sender_id, metadata')
        .eq('channel_id', channel.id)
        .contains('metadata', { doubt_id: id })
        .maybeSingle();

      if (parentMsg) {
        const nextStatus = decision.mode === 'takeover' ? 'taken_over' : 'instructed';
        const updatedMeta = {
          ...(parentMsg.metadata as any),
          status: nextStatus,
          ...(decision.mode === 'instruct' ? { instruction: decision.instruction } : {}),
        };

        const { data: updatedParent } = await supabaseAdmin
          .from('messages')
          .update({ metadata: updatedMeta })
          .eq('id', parentMsg.id)
          .select('*, sender:users!sender_id(id, display_name, avatar_url)')
          .single();

        const io = req.app.get('io');
        if (io && updatedParent) {
          io.to(channel.id).emit('message_updated', updatedParent);
        }

        if (decision.mode === 'takeover') {
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('display_name')
            .eq('id', req.userId!)
            .single();

          const name = user?.display_name || 'A teammate';
          const threadNotice = `👤 ${name} has taken over this conversation.`;

          const { data: takeoverMsg } = await supabaseAdmin
            .from('messages')
            .insert({
              channel_id: channel.id,
              parent_message_id: parentMsg.id,
              sender_id: req.userId!,
              content: threadNotice,
              type: 'text',
            })
            .select('*, sender:users!sender_id(id, display_name, avatar_url)')
            .single();

          if (takeoverMsg) {
            await supabaseAdmin.from('message_threads').insert({
              parent_message_id: parentMsg.id,
              reply_message_id: takeoverMsg.id,
            });
            if (io) {
              io.to(channel.id).emit('new_message', takeoverMsg);
              io.to(channel.id).emit('thread_reply', takeoverMsg);
            }
          }
        } else if (decision.mode === 'instruct') {
          // Post bot acknowledgment reply in the thread
          const botReplyContent = "Got it! I've saved this guidance and queued the reply to send to the candidate.";
          let botUserId = parentMsg.sender_id;
          try {
            const { data: bot } = await supabaseAdmin
              .from('squad_bots')
              .select('id, slug, internal_name, public_name')
              .eq('id', channel.squad_bot_id)
              .maybeSingle();
            if (bot && channel.workspace_id) {
              const botUser = await getOrCreateBotUser(bot, channel.workspace_id);
              if (botUser?.id) botUserId = botUser.id;
            }
          } catch (botUserErr) {
            console.warn('[squad-bot-channels] bot user lookup fallback:', botUserErr);
          }

          const { data: botReply } = await supabaseAdmin
            .from('messages')
            .insert({
              channel_id: channel.id,
              parent_message_id: parentMsg.id,
              sender_id: botUserId,
              content: botReplyContent,
              type: 'text',
            })
            .select('*, sender:users!sender_id(id, display_name, avatar_url)')
            .single();

          if (botReply) {
            await supabaseAdmin.from('message_threads').insert({
              parent_message_id: parentMsg.id,
              reply_message_id: botReply.id,
            });
            if (io) {
              io.to(channel.id).emit('new_message', botReply);
              io.to(channel.id).emit('thread_reply', botReply);
            }
          }
        }
      }
    } catch (syncErr) {
      console.error('[squad-bot-channels] error syncing doubt resolution to message:', syncErr);
    }

    res.json({ success: true, data });
  } catch (e) { res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not save the response' }); }
});

router.post('/:channelId/doubts/:doubtId/close', async (req, res) => {
  try {
    const channel = await access(req, res, true);
    if (!channel) return;
    const doubtId = z.string().uuid().parse(req.params.doubtId);
    const closeSchema = z.object({
      closed: z.boolean().default(true),
    });
    const { closed } = closeSchema.parse(req.body ?? {});

    const { data: parentMsg } = await supabaseAdmin
      .from('messages')
      .select('id, channel_id, metadata')
      .eq('channel_id', channel.id)
      .contains('metadata', { doubt_id: doubtId })
      .maybeSingle();

    if (!parentMsg) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Ensure the doubt belongs to this channel's bot (no cross-bot closes).
    const { data: doubtRow } = await supabaseAdmin
      .from('squad_bot_doubts')
      .select('id, bot_id')
      .eq('id', doubtId)
      .maybeSingle();
    if (doubtRow && doubtRow.bot_id !== channel.squad_bot_id) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const currentMeta = (parentMsg.metadata as any) || {};
    const updatedMeta = {
      ...currentMeta,
      is_closed: closed,
      closed_at: closed ? new Date().toISOString() : null,
      closed_by: closed ? req.userId : null,
    };

    const { data: updatedParent, error: updateErr } = await supabaseAdmin
      .from('messages')
      .update({ metadata: updatedMeta })
      .eq('id', parentMsg.id)
      .select('*, sender:users!sender_id(id, display_name, avatar_url)')
      .single();

    if (updateErr) throw updateErr;

    // Persist close state on the doubt row (columns added in
    // 20260929180000_bot_doubt_closed.sql).
    const { error: doubtCloseErr } = await supabaseAdmin
      .from('squad_bot_doubts')
      .update(
        closed
          ? { closed_at: new Date().toISOString(), closed_by: req.userId }
          : { closed_at: null, closed_by: null },
      )
      .eq('id', doubtId);
    if (doubtCloseErr) {
      console.warn('[squad-bot-channels] doubt close-state sync failed:', doubtCloseErr.message);
    }

    const io = req.app.get('io');
    if (io && updatedParent) {
      io.to(channel.id).emit('message_updated', updatedParent);
    }

    // Post notice in the thread
    try {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('display_name')
        .eq('id', req.userId!)
        .single();
      const userName = user?.display_name || 'A teammate';
      const noticeContent = closed
        ? `🔒 ${userName} marked this conversation as closed.`
        : `🔓 ${userName} reopened this conversation.`;

      const { data: noticeMsg } = await supabaseAdmin
        .from('messages')
        .insert({
          channel_id: channel.id,
          parent_message_id: parentMsg.id,
          sender_id: req.userId!,
          content: noticeContent,
          type: 'text',
        })
        .select('*, sender:users!sender_id(id, display_name, avatar_url)')
        .single();

      if (noticeMsg) {
        await supabaseAdmin.from('message_threads').insert({
          parent_message_id: parentMsg.id,
          reply_message_id: noticeMsg.id,
        });
        if (io) {
          io.to(channel.id).emit('new_message', noticeMsg);
          io.to(channel.id).emit('thread_reply', noticeMsg);
        }
      }
    } catch (noticeErr) {
      console.warn('[squad-bot-channels] close notice error:', noticeErr);
    }

    res.json({ success: true, data: { is_closed: closed } });
  } catch (e) {
    res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not update conversation status' });
  }
});

export default router;
