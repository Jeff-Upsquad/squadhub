import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { jobSchema, listJobs, periodBounds, periodSchema } from '../services/squadBotJobs';

// Mounted below the parent router's admin/auth guards.
const router = Router({ mergeParams: true });
router.use(async (req, res, next) => {
  const botId = (req.params as { id: string }).id;
  if (!z.string().uuid().safeParse(botId).success) { res.status(400).json({ error: 'Invalid bot ID' }); return; }
  const { data, error } = await supabaseAdmin.from('squad_bots').select('id').eq('id', botId).maybeSingle();
  if (error) { res.status(500).json({ error: 'Could not load bot' }); return; }
  if (!data) { res.status(404).json({ error: 'Bot not found' }); return; }
  next();
});
router.get('/jobs', async (req, res) => {
  try { res.json({ success: true, data: await listJobs((req.params as { id: string }).id) }); }
  catch { res.status(500).json({ error: 'Could not load jobs' }); }
});
router.post('/jobs', async (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { data, error } = await supabaseAdmin.from('squad_bot_jobs').insert({ ...parsed.data, bot_id: (req.params as { id: string }).id }).select('*').single();
  if (error) { res.status(500).json({ error: 'Could not create job' }); return; }
  res.status(201).json({ success: true, data });
});
router.put<{ id: string; jobId: string }>('/jobs/:jobId', async (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }
  const { data, error } = await supabaseAdmin.from('squad_bot_jobs').update(parsed.data).eq('bot_id', (req.params as { id: string }).id).eq('id', req.params.jobId).select('*').maybeSingle();
  if (error) { res.status(500).json({ error: 'Could not update job' }); return; }
  if (!data) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json({ success: true, data });
});
router.patch<{ id: string; jobId: string }>('/jobs/:jobId', async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Provide the job on/off setting' }); return; }
  const { data, error } = await supabaseAdmin.from('squad_bot_jobs').update(parsed.data).eq('bot_id', req.params.id).eq('id', req.params.jobId).select('*').maybeSingle();
  if (error) { res.status(500).json({ error: 'Could not change job' }); return; }
  if (!data) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json({ success: true, data });
});
router.get('/activity', async (req, res) => {
  const parsed = z.object({
    period: periodSchema.default('daily'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    job_id: z.string().uuid().optional(), page: z.coerce.number().int().min(0).max(100000).default(0),
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid activity filters' }); return; }
  const { period, date, job_id, page } = parsed.data;
  let bounds;
  try { bounds = periodBounds(period, date); } catch { res.status(400).json({ error: 'Invalid date' }); return; }
  try {
    const botId = (req.params as { id: string }).id;
    let query = supabaseAdmin.from('squad_bot_activity').select('*', { count: 'exact' }).eq('bot_id', botId).gte('created_at', bounds.start).lt('created_at', bounds.end);
    if (job_id) query = query.eq('job_id', job_id);
    const [activity, summary] = await Promise.all([
      query.order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24),
      supabaseAdmin.rpc('squad_bot_activity_summary', { p_bot_id: botId, p_start: bounds.start, p_end: bounds.end, p_job_id: job_id ?? null }),
    ]);
    if (activity.error || summary.error) throw new Error('Could not load activity');
    res.json({ success: true, data: { ...bounds, activity: activity.data, total: activity.count, summary: summary.data } });
  } catch { res.status(500).json({ error: 'Could not load activity' }); }
});
export default router;
