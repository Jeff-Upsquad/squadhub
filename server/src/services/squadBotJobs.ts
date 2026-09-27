import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import type { SquadBotStatus } from './squadBots';

const scopeId = z.string().trim().min(1).max(200);
export const jobSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['conversation', 'action']),
  instructions: z.string().trim().max(20000).default(''),
  audience: z.enum(['any', 'candidates', 'customers']).default('any'),
  person_ids: z.array(scopeId).max(500).default([]),
  pipeline_id: scopeId.nullable().default(null),
  stage_id: scopeId.nullable().default(null),
  enabled: z.boolean().default(false),
}).refine((v) => !v.stage_id || !!v.pipeline_id, { message: 'Choose a pipeline before a stage', path: ['stage_id'] });
export type Job = z.infer<typeof jobSchema> & { id: string; bot_id: string };
export const targetSchema = z.object({
  audience: z.enum(['candidates', 'customers']).optional(),
  person_id: scopeId.optional(),
  pipeline_id: scopeId.optional(),
  stage_id: scopeId.optional(),
});
export type JobTarget = z.infer<typeof targetSchema>;

export function jobBlockReason(job: Job, status: SquadBotStatus, target: JobTarget): string | null {
  if (status === 'off') return 'This bot is turned off';
  if (!job.enabled) return 'This job is turned off';
  if (job.audience !== 'any' && job.audience !== target.audience) return 'The audience is outside this job';
  if (job.person_ids.length && (!target.person_id || !job.person_ids.includes(target.person_id))) return 'The person is outside this job';
  if (job.pipeline_id && job.pipeline_id !== target.pipeline_id) return 'The pipeline is outside this job';
  if (job.stage_id && job.stage_id !== target.stage_id) return 'The stage is outside this job';
  return null;
}

export async function listJobs(botId: string): Promise<Job[]> {
  const { data, error } = await supabaseAdmin.from('squad_bot_jobs').select('*').eq('bot_id', botId).order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Relative links remain on the admin site; external app links must use HTTPS.
export function safeActivityUrl(value: string): boolean {
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
export const activitySchema = z.object({
  job_id: z.string().uuid(),
  event_id: z.string().trim().min(1).max(200),
  outcome: z.enum(['completed', 'failed', 'skipped', 'drafted']),
  note: z.string().trim().min(1).max(4000),
  target_url: z.string().max(2000).refine(safeActivityUrl, 'Use an HTTPS URL or site-relative path').nullable().optional(),
});

export const periodSchema = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
export function periodBounds(period: z.infer<typeof periodSchema>, date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
  if (period === 'weekly') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (['monthly', 'quarterly', 'yearly'].includes(period)) start.setUTCDate(1);
  if (period === 'quarterly') start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
  if (period === 'yearly') start.setUTCMonth(0);
  const end = new Date(start);
  if (period === 'daily' || period === 'weekly') end.setUTCDate(end.getUTCDate() + (period === 'daily' ? 1 : 7));
  else end.setUTCMonth(end.getUTCMonth() + ({ monthly: 1, quarterly: 3, yearly: 12 }[period]));
  return { start: start.toISOString(), end: end.toISOString() };
}
