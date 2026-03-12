import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const createDmSchema = z.object({
  workspace_id: z.string().uuid(),
  participant_ids: z.array(z.string().uuid()).min(1).max(8),
});

// GET /dms?workspace_id=xxx — list DM conversations for the user
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id required' });
      return;
    }

    // Find all DM conversations this user is a participant of
    const { data: participantRows, error: pError } = await supabaseAdmin
      .from('dm_participants')
      .select('conversation_id')
      .eq('user_id', req.userId!);

    if (pError) {
      res.status(500).json({ success: false, error: pError.message });
      return;
    }

    if (!participantRows?.length) {
      res.json({ success: true, data: [] });
      return;
    }

    const conversationIds = participantRows.map((r: any) => r.conversation_id);

    // Fetch the conversations with participants
    const { data: conversations, error } = await supabaseAdmin
      .from('dm_conversations')
      .select('*, participants:dm_participants(user_id, user:users(id, display_name, avatar_url))')
      .in('id', conversationIds)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: conversations });
  } catch (err) {
    console.error('Get DMs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /dms — create or find existing DM conversation
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createDmSchema.parse(req.body);
    const allParticipants = [...new Set([req.userId!, ...body.participant_ids])];

    // Check if a DM with exactly these participants already exists in this workspace
    // (for 1:1 DMs only — group DMs always create new)
    if (allParticipants.length === 2) {
      const { data: existing } = await supabaseAdmin.rpc('find_existing_dm', {
        p_workspace_id: body.workspace_id,
        p_user_ids: allParticipants,
        p_count: allParticipants.length,
      });

      if (existing && existing.length > 0) {
        // Return existing conversation
        const { data: conv } = await supabaseAdmin
          .from('dm_conversations')
          .select('*, participants:dm_participants(user_id, user:users(id, display_name, avatar_url))')
          .eq('id', existing[0].id)
          .single();

        res.json({ success: true, data: conv });
        return;
      }
    }

    // Create new DM conversation
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('dm_conversations')
      .insert({ workspace_id: body.workspace_id })
      .select()
      .single();

    if (convError) {
      res.status(500).json({ success: false, error: convError.message });
      return;
    }

    // Add all participants
    const participantInserts = allParticipants.map((uid) => ({
      conversation_id: conversation.id,
      user_id: uid,
    }));

    await supabaseAdmin.from('dm_participants').insert(participantInserts);

    // Fetch back with participants
    const { data: fullConv } = await supabaseAdmin
      .from('dm_conversations')
      .select('*, participants:dm_participants(user_id, user:users(id, display_name, avatar_url))')
      .eq('id', conversation.id)
      .single();

    res.status(201).json({ success: true, data: fullConv });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create DM error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
