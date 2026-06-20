import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { mirrorCourseAssignment } from '../services/taskMirror';

const router = Router();
router.use(requireAuth);

// Keep an assignment's mirror task in sync without ever failing the learner's
// request (status change → the mirror updates/removes itself).
function syncCourseMirror(assignmentId: string): void {
  mirrorCourseAssignment(assignmentId).catch((err) =>
    console.error('[lms] course mirror sync failed:', err),
  );
}

// Which lessons of a set is this user allowed to see?
// A lesson with no audience rows is visible to everyone enrolled; otherwise it
// is visible only to matching user_types OR explicitly listed users.
async function getVisibleLessonIds(
  lessonIds: string[],
  userId: string,
  userType: string | null,
): Promise<Set<string>> {
  if (lessonIds.length === 0) return new Set();

  const [{ data: typeRows }, { data: userRows }] = await Promise.all([
    supabaseAdmin.from('lms_lesson_audience_types').select('lesson_id, user_type').in('lesson_id', lessonIds),
    supabaseAdmin.from('lms_lesson_audience_users').select('lesson_id, user_id').in('lesson_id', lessonIds),
  ]);

  const typesByLesson = new Map<string, string[]>();
  for (const r of typeRows || []) {
    const list = typesByLesson.get((r as any).lesson_id) || [];
    list.push((r as any).user_type);
    typesByLesson.set((r as any).lesson_id, list);
  }
  const usersByLesson = new Map<string, string[]>();
  for (const r of userRows || []) {
    const list = usersByLesson.get((r as any).lesson_id) || [];
    list.push((r as any).user_id);
    usersByLesson.set((r as any).lesson_id, list);
  }

  const visible = new Set<string>();
  for (const id of lessonIds) {
    const types = typesByLesson.get(id) || [];
    const users = usersByLesson.get(id) || [];
    if (types.length === 0 && users.length === 0) {
      visible.add(id); // unrestricted — inherits the course audience
    } else if ((userType && types.includes(userType)) || users.includes(userId)) {
      visible.add(id);
    }
  }
  return visible;
}

// ------------------------------------------------------------
// GET /lms/my-items — assignments for the current user
// ------------------------------------------------------------
router.get('/my-items', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('lms_assignments')
      .select(`
        id, status, progress_percent, assigned_at, started_at, completed_at,
        item:lms_items(
          id, kind, track, title, slug, summary, cover_image_url, status, published_at,
          category:lms_categories(id, name, slug, color)
        )
      `)
      .eq('user_id', req.userId!)
      .order('assigned_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Filter out assignments whose item has been unpublished/archived
    const visible = (data || []).filter((a: any) => a.item && a.item.status === 'published');
    res.json({ success: true, data: visible });
  } catch (err) {
    console.error('List my LMS items error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /lms/my-due — the current user's non-completed assignments whose
// due_date is today or overdue (in the caller's timezone). Powers the Home
// "Courses" secondary card. Day-bucketing mirrors /pm/tasks/my.
// ------------------------------------------------------------
router.get('/my-due', async (req: Request, res: Response) => {
  try {
    const tz = (req.query.tz as string) || 'Asia/Kolkata';

    const { data, error } = await supabaseAdmin
      .from('lms_assignments')
      .select(`
        id, status, progress_percent, assigned_at, started_at, completed_at, due_date,
        item:lms_items(
          id, kind, track, title, slug, summary, cover_image_url, status, published_at,
          category:lms_categories(id, name, slug, color)
        )
      `)
      .eq('user_id', req.userId!)
      .neq('status', 'completed')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Same day-key approach as /pm/tasks/my: format the timestamp into the
    // caller's timezone before comparing, so users east of UTC don't lose a day.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const todayStr = fmt.format(new Date());

    const due = (data || []).filter((a: any) => {
      // Hide assignments whose course was unpublished/archived.
      if (!a.item || a.item.status !== 'published') return false;
      if (!a.due_date) return false;
      const dueStr = fmt.format(new Date(a.due_date));
      return dueStr <= todayStr; // today or overdue
    });

    res.json({ success: true, data: due });
  } catch (err) {
    console.error('List due LMS items error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /lms/categories — for filter chips in the UI
// ------------------------------------------------------------
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('lms_categories')
      .select('*')
      .order('position', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List categories error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /lms/items/:id — full item with lessons + blocks
// Only accessible if user is assigned OR is admin.
// ------------------------------------------------------------
router.get('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.id;

    // Load the requesting user's profile once — user_type drives lesson-level
    // audience filtering, is_admin gates access + preview.
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('is_admin, user_type')
      .eq('id', req.userId!)
      .single();
    const isAdmin = !!(profile as any)?.is_admin;
    const userType = (profile as any)?.user_type ?? null;

    // Check access: either there's an assignment or the user is admin
    const { data: assignment } = await supabaseAdmin
      .from('lms_assignments')
      .select('id, status, progress_percent, started_at, completed_at')
      .eq('item_id', itemId)
      .eq('user_id', req.userId!)
      .maybeSingle();

    if (!assignment && !isAdmin) {
      res.status(403).json({ success: false, error: 'Not assigned to this content' });
      return;
    }

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('lms_items')
      .select(`
        id, kind, track, title, slug, summary, cover_image_url, status, published_at, created_at, updated_at,
        category:lms_categories(id, name, slug, color)
      `)
      .eq('id', itemId)
      .single();

    if (itemErr || !item) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    if ((item as any).status !== 'published' && !isAdmin) {
      res.status(403).json({ success: false, error: 'Not published' });
      return;
    }

    // Inactive lessons are hidden from every learner-facing view (admins manage
    // them in the admin editor). Audience filtering below further narrows these.
    let lessons = (await supabaseAdmin
      .from('lms_lessons')
      .select('*')
      .eq('item_id', itemId)
      .eq('is_active', true)
      .order('position', { ascending: true })).data || [];

    // Apply lesson-level audience for real learners. Admins previewing an item
    // they aren't enrolled in still see every lesson.
    if (assignment) {
      const visibleIds = await getVisibleLessonIds(
        lessons.map((l: any) => l.id),
        req.userId!,
        userType,
      );
      lessons = lessons.filter((l: any) => visibleIds.has(l.id));
    }

    const lessonIds = lessons.map((l: any) => l.id);
    const { data: blocks } = lessonIds.length
      ? await supabaseAdmin
          .from('lms_content_blocks')
          .select('*')
          .in('lesson_id', lessonIds)
          .order('position', { ascending: true })
      : { data: [] };

    const quizBlockIds = (blocks || []).filter((b: any) => b.type === 'quiz').map((b: any) => b.id);
    const { data: quizQuestions } = quizBlockIds.length
      ? await supabaseAdmin
          .from('lms_quiz_questions')
          .select('*')
          .in('block_id', quizBlockIds)
          .order('position', { ascending: true })
      : { data: [] };

    // Strip correct_option_id from client payload — grading happens server-side
    const sanitizedQuestions = (quizQuestions || []).map((q: any) => ({
      id: q.id,
      block_id: q.block_id,
      position: q.position,
      prompt: q.prompt,
      options: q.options,
      explanation: null, // only revealed after attempt
    }));

    const questionsByBlock = new Map<string, any[]>();
    for (const q of sanitizedQuestions) {
      const list = questionsByBlock.get(q.block_id) || [];
      list.push(q);
      questionsByBlock.set(q.block_id, list);
    }

    const blocksByLesson = new Map<string, any[]>();
    for (const b of blocks || []) {
      const list = blocksByLesson.get(b.lesson_id) || [];
      const block = b.type === 'quiz'
        ? { ...b, quiz_questions: questionsByBlock.get(b.id) || [] }
        : b;
      list.push(block);
      blocksByLesson.set(b.lesson_id, list);
    }

    const fullLessons = (lessons || []).map((l: any) => ({
      ...l,
      blocks: blocksByLesson.get(l.id) || [],
    }));

    // Completed-lesson ids for this user's assignment
    let completedLessonIds: string[] = [];
    if (assignment) {
      const { data: progress } = await supabaseAdmin
        .from('lms_lesson_progress')
        .select('lesson_id')
        .eq('assignment_id', (assignment as any).id);
      completedLessonIds = (progress || []).map((p: any) => p.lesson_id);
    }

    res.json({
      success: true,
      data: {
        item: { ...item, lessons: fullLessons },
        assignment: assignment ? { ...assignment, completed_lesson_ids: completedLessonIds } : null,
      },
    });
  } catch (err) {
    console.error('Get LMS item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /lms/assignments/:id/start — mark in_progress
// ------------------------------------------------------------
router.post('/assignments/:id/start', async (req: Request, res: Response) => {
  try {
    const { data: assignment, error: fetchErr } = await supabaseAdmin
      .from('lms_assignments')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId!)
      .single();

    if (fetchErr || !assignment) {
      res.status(404).json({ success: false, error: 'Assignment not found' });
      return;
    }

    if ((assignment as any).status === 'completed') {
      res.json({ success: true, data: assignment });
      return;
    }

    const patch: Record<string, any> = {
      status: 'in_progress',
      started_at: (assignment as any).started_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('lms_assignments')
      .update(patch)
      .eq('id', (assignment as any).id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    syncCourseMirror((assignment as any).id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Start assignment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /lms/assignments/:id/lessons/:lessonId/complete
// Upserts lesson progress, recomputes progress_percent + status.
// ------------------------------------------------------------
router.post('/assignments/:id/lessons/:lessonId/complete', async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id as string;
    const lessonId = req.params.lessonId as string;

    const { data: assignment } = await supabaseAdmin
      .from('lms_assignments')
      .select('*')
      .eq('id', assignmentId)
      .eq('user_id', req.userId!)
      .single();

    if (!assignment) {
      res.status(404).json({ success: false, error: 'Assignment not found' });
      return;
    }

    // Verify lesson belongs to this assignment's item
    const { data: lesson } = await supabaseAdmin
      .from('lms_lessons')
      .select('id, item_id')
      .eq('id', lessonId)
      .single();

    if (!lesson || (lesson as any).item_id !== (assignment as any).item_id) {
      res.status(400).json({ success: false, error: 'Lesson does not belong to this assignment' });
      return;
    }

    // Which lessons can this user see? Progress is measured against their
    // visible set, and a hidden lesson can't be completed at all.
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('user_type')
      .eq('id', req.userId!)
      .single();

    const { data: allLessons } = await supabaseAdmin
      .from('lms_lessons')
      .select('id')
      .eq('item_id', (assignment as any).item_id);
    const visibleIds = await getVisibleLessonIds(
      (allLessons || []).map((l: any) => l.id),
      req.userId!,
      (profile as any)?.user_type ?? null,
    );

    if (!visibleIds.has(lessonId)) {
      res.status(403).json({ success: false, error: 'Lesson not available' });
      return;
    }

    // Upsert progress row
    const { error: upsertErr } = await supabaseAdmin
      .from('lms_lesson_progress')
      .upsert(
        { assignment_id: assignmentId, lesson_id: lessonId, completed_at: new Date().toISOString() },
        { onConflict: 'assignment_id,lesson_id' },
      );

    if (upsertErr) {
      res.status(500).json({ success: false, error: upsertErr.message });
      return;
    }

    // Recompute progress against the user's visible lessons only.
    const { data: progressRows } = await supabaseAdmin
      .from('lms_lesson_progress')
      .select('lesson_id')
      .eq('assignment_id', assignmentId);
    const done = (progressRows || []).filter((p: any) => visibleIds.has(p.lesson_id)).length;

    const total = visibleIds.size || 1;
    const percent = Math.round((done / total) * 100);
    const isComplete = visibleIds.size > 0 && done >= visibleIds.size;

    const patch: Record<string, any> = {
      progress_percent: percent,
      status: isComplete ? 'completed' : 'in_progress',
      started_at: (assignment as any).started_at ?? new Date().toISOString(),
      completed_at: isComplete ? ((assignment as any).completed_at ?? new Date().toISOString()) : null,
    };

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('lms_assignments')
      .update(patch)
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateErr) {
      res.status(500).json({ success: false, error: updateErr.message });
      return;
    }

    // Completing the assignment removes its mirror task; otherwise it stays.
    syncCourseMirror(assignmentId);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Complete lesson error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /lms/assignments/:id/quiz/:blockId/submit
// Grades a quiz and stores the attempt.
// ------------------------------------------------------------
const quizSubmitSchema = z.object({
  answers: z.record(z.string(), z.string()),
});

router.post('/assignments/:id/quiz/:blockId/submit', async (req: Request, res: Response) => {
  try {
    const { id: assignmentId, blockId } = req.params;
    const { answers } = quizSubmitSchema.parse(req.body);

    const { data: assignment } = await supabaseAdmin
      .from('lms_assignments')
      .select('id, item_id, user_id')
      .eq('id', assignmentId)
      .eq('user_id', req.userId!)
      .single();

    if (!assignment) {
      res.status(404).json({ success: false, error: 'Assignment not found' });
      return;
    }

    const { data: questions } = await supabaseAdmin
      .from('lms_quiz_questions')
      .select('id, correct_option_id, explanation')
      .eq('block_id', blockId);

    if (!questions || questions.length === 0) {
      res.status(404).json({ success: false, error: 'Quiz has no questions' });
      return;
    }

    let correct = 0;
    const per: Record<string, { is_correct: boolean; correct_option_id: string; explanation: string | null }> = {};
    for (const q of questions as any[]) {
      const given = answers[q.id];
      const ok = given === q.correct_option_id;
      if (ok) correct += 1;
      per[q.id] = { is_correct: ok, correct_option_id: q.correct_option_id, explanation: q.explanation };
    }

    const scorePercent = Math.round((correct / questions.length) * 100);
    const passed = scorePercent >= 70; // default pass bar; per-block metadata may override later

    const { data: attempt, error: insertErr } = await supabaseAdmin
      .from('lms_quiz_attempts')
      .insert({
        assignment_id: assignmentId,
        block_id: blockId,
        answers,
        score_percent: scorePercent,
        passed,
      })
      .select()
      .single();

    if (insertErr) {
      res.status(500).json({ success: false, error: insertErr.message });
      return;
    }

    res.json({
      success: true,
      data: {
        attempt,
        score_percent: scorePercent,
        passed,
        questions: per,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Submit quiz error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
