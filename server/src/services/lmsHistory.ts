import type { Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';

const paramsSchema = z.object({ id: z.string().uuid(), versionId: z.string().uuid().optional() });
const pageSchema = z.coerce.number().int().min(0).max(100000).default(0);
const lessonSchema = z.string().uuid();
const PAGE_SIZE = 30;

/** Call only after document-level author/admin authorization. No write endpoint. */
export async function readLmsHistory(req: Request, res: Response): Promise<void> {
  const params = paramsSchema.safeParse(req.params);
  const page = pageSchema.safeParse(req.query.page);
  const lesson = lessonSchema.safeParse(req.query.lesson_id);
  if (!params.success || !page.success || !lesson.success) {
    res.status(400).json({ success: false, error: 'Invalid history request' });
    return;
  }
  const { id, versionId } = params.data;
  try {
    if (versionId) {
      const { data, error } = await supabaseAdmin.from('lms_item_versions')
        .select('id, changed_at, change_label, page_title, page_id, snapshot')
        .eq('item_id', id).eq('page_id', lesson.data).eq('id', versionId).maybeSingle();
      if (error) throw error;
      if (!data) { res.status(404).json({ success: false, error: 'Version not found' }); return; }
      const snapshot = data.snapshot as { document: unknown; pages?: { id: string }[] };
      res.json({ success: true, data: {
        ...data,
        snapshot: { ...snapshot, pages: (snapshot.pages ?? []).filter(page => page.id === lesson.data) },
      } });
    } else {
      const start = page.data * PAGE_SIZE;
      const { data, error } = await supabaseAdmin.from('lms_item_versions')
        .select('id, changed_at, change_label, page_title')
        .eq('item_id', id).eq('page_id', lesson.data)
        .order('changed_at', { ascending: false }).order('id', { ascending: false })
        .range(start, start + PAGE_SIZE);
      if (error) throw error;
      res.json({ success: true, data: (data ?? []).slice(0, PAGE_SIZE), has_more: (data?.length ?? 0) > PAGE_SIZE });
    }
  } catch (error) {
    console.error('[lms-history] read failed:', error);
    res.status(500).json({ success: false, error: 'Could not load changes' });
  }
}
