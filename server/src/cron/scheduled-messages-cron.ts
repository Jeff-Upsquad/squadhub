import { supabaseAdmin } from '../supabase';
import type { Server } from 'socket.io';

/**
 * Delivers due scheduled chat messages (chat_scheduled_messages, status
 * 'pending', scheduled_at <= now). Mirrors POST /messages: insert, legacy
 * message_threads row for thread replies, socket emits. Claims each row
 * (pending → sent) before inserting so overlapping sweeps can't double-send.
 */
const SWEEP_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;

export function startScheduledMessagesSweeper(io: Server): void {
  const sweep = async (): Promise<void> => {
    try {
      const { data: due } = await supabaseAdmin
        .from('chat_scheduled_messages')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(BATCH_SIZE);

      for (const row of due || []) {
        const { data: claimed } = await supabaseAdmin
          .from('chat_scheduled_messages')
          .update({ status: 'sent' })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (!claimed) continue; // another sweep got it

        const { data: message, error } = await supabaseAdmin
          .from('messages')
          .insert({
            channel_id: row.channel_id,
            dm_conversation_id: row.dm_conversation_id,
            sender_id: row.user_id,
            content: row.content,
            type: 'text',
            mentions: [],
            ...(row.parent_message_id ? { parent_message_id: row.parent_message_id } : {}),
          })
          .select('*, sender:users!sender_id(id, display_name, avatar_url)')
          .single();

        if (error || !message) {
          console.error('[ScheduledMessages] insert failed, returning row to pending', row.id, error);
          await supabaseAdmin
            .from('chat_scheduled_messages')
            .update({ status: 'pending' })
            .eq('id', row.id);
          continue;
        }

        await supabaseAdmin
          .from('chat_scheduled_messages')
          .update({ sent_message_id: message.id })
          .eq('id', row.id);

        if (row.parent_message_id) {
          await supabaseAdmin.from('message_threads').insert({
            parent_message_id: row.parent_message_id,
            reply_message_id: message.id,
          });
        }

        const room = row.channel_id || row.dm_conversation_id;
        io.to(room).emit('new_message', message);
        if (row.parent_message_id) {
          io.to(room).emit('thread_reply', message);
        }
      }
    } catch (err) {
      console.error('[ScheduledMessages] sweep failed', err);
    }
  };

  setInterval(sweep, SWEEP_INTERVAL_MS);
  void sweep();
  console.log('[ScheduledMessages] sweeper initialized (30s interval)');
}
