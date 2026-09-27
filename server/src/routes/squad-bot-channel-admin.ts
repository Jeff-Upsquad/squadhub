import { Router, Request } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { botChannel, ensureBotChannel, eligibleBotChannelMember } from '../services/squadBotChannels';

// Mounted under the authenticated platform-admin Squad Bots router.
const router = Router({ mergeParams: true });
router.get('/channel', async (req: Request, res) => {
  try {
    const channel = await botChannel(String(req.params.id));
    const workspaces = await supabaseAdmin.from('workspace_members').select('workspace_id, workspace:workspaces(id,name)').eq('user_id', req.userId!);
    if (workspaces.error) throw workspaces.error;
    if (!channel) { res.json({ success: true, data: { channel: null, workspaces: workspaces.data, members: [], users: [] } }); return; }
    const [members, users] = await Promise.all([
      supabaseAdmin.from('resource_memberships').select('id,user_id,access_level,user:users!resource_memberships_user_id_fkey(id,display_name,email)').eq('resource_type','channel').eq('resource_id',channel.id),
      supabaseAdmin.from('workspace_members').select('user:users!inner(id,display_name,email,user_type,status)').eq('workspace_id',channel.workspace_id).eq('user.user_type','internal'),
    ]);
    if (members.error || users.error) throw members.error ?? users.error;
    res.json({ success: true, data: { channel, workspaces: workspaces.data, members: members.data, users: users.data.map((u: any) => u.user).filter((u: any) => !['banned','suspended'].includes(u.status)) } });
  } catch { res.status(500).json({ error: 'Could not load bot channel' }); }
});
router.post('/channel', async (req: Request, res) => {
  try {
    const { workspace_id } = z.object({ workspace_id: z.string().uuid() }).parse(req.body);
    res.json({ success: true, data: await ensureBotChannel(String(req.params.id), workspace_id, req.userId!) });
  } catch (e) { res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not create bot channel' }); }
});
router.post('/channel/admins', async (req: Request, res) => {
  try {
    const { user_id } = z.object({ user_id: z.string().uuid() }).parse(req.body);
    const channel = await botChannel(String(req.params.id));
    if (!channel) { res.status(404).json({ error: 'Create the channel first' }); return; }
    if (!await eligibleBotChannelMember(channel.id, user_id)) { res.status(400).json({ error: 'Choose an active internal user in this workspace' }); return; }
    const { error } = await supabaseAdmin.from('resource_memberships').upsert({
      resource_type: 'channel', resource_id: channel.id, user_id, access_level: 'manager', invited_by: req.userId,
    }, { onConflict: 'resource_type,resource_id,user_id' });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(e instanceof z.ZodError ? 400 : 500).json({ error: 'Could not add channel admin' }); }
});
export default router;
