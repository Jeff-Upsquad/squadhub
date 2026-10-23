-- Knowledge edits are queued at document or page level. The server turns each
-- pending revision into the same Resources send/recipient/task used by SOPs.
CREATE TABLE public.lms_knowledge_review_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  reviewer_user_id UUID NOT NULL REFERENCES public.users(id)
);
ALTER TABLE public.lms_knowledge_review_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lms_knowledge_review_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lms_knowledge_review_config TO service_role;

INSERT INTO public.lms_knowledge_review_config (reviewer_user_id)
SELECT id FROM public.users WHERE email = 'jeff@upsquadconnect.com' AND user_type = 'internal'
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE public.lms_knowledge_review_changes (
  item_id UUID NOT NULL REFERENCES public.lms_items(id) ON DELETE CASCADE,
  page_key UUID NOT NULL,
  lesson_id UUID REFERENCES public.lms_lessons(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, page_key)
);
CREATE INDEX lms_knowledge_review_pending ON public.lms_knowledge_review_changes(changed_at)
  WHERE processed_at IS NULL;
ALTER TABLE public.lms_knowledge_review_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lms_knowledge_review_changes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lms_knowledge_review_changes TO service_role;

-- A stable key lets the worker reuse a page's task through subsequent edits.
ALTER TABLE public.lms_task_sends ADD COLUMN knowledge_review_key TEXT;
CREATE UNIQUE INDEX lms_task_sends_knowledge_review_key
  ON public.lms_task_sends(knowledge_review_key) WHERE knowledge_review_key IS NOT NULL;

CREATE FUNCTION public.queue_knowledge_review(p_item_id UUID, p_lesson_id UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key UUID := coalesce(p_lesson_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF EXISTS (SELECT 1 FROM lms_items WHERE id = p_item_id AND track = 'knowledge' AND origin_item_id IS NULL) THEN
    INSERT INTO lms_knowledge_review_changes(item_id, page_key, lesson_id)
    VALUES (p_item_id, v_key, p_lesson_id)
    ON CONFLICT (item_id, page_key) DO UPDATE
      SET revision = lms_knowledge_review_changes.revision + 1, changed_at = now(), processed_at = NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.queue_knowledge_review(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_knowledge_review(UUID, UUID) TO service_role;

CREATE FUNCTION public.knowledge_review_item_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
    (to_jsonb(NEW) - ARRAY['updated_at','squadhire_synced_at','squadhire_last_error']::text[])
      IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['updated_at','squadhire_synced_at','squadhire_last_error']::text[]) THEN
    PERFORM queue_knowledge_review(NEW.id, NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_review_item AFTER INSERT OR UPDATE ON public.lms_items
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_item_change();

CREATE FUNCTION public.knowledge_review_lesson_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM queue_knowledge_review(OLD.item_id, NULL);
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' OR (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    PERFORM queue_knowledge_review(NEW.item_id, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_review_lesson AFTER INSERT OR UPDATE OR DELETE ON public.lms_lessons
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_lesson_change();

CREATE FUNCTION public.knowledge_review_child_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lesson_id UUID; v_item_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'lms_content_blocks' THEN
    v_lesson_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lesson_id ELSE NEW.lesson_id END;
  ELSIF TG_TABLE_NAME = 'lms_quiz_questions' OR TG_TABLE_NAME = 'lms_content_block_videos' THEN
    SELECT lesson_id INTO v_lesson_id FROM lms_content_blocks
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.block_id ELSE NEW.block_id END;
  ELSIF TG_TABLE_NAME IN ('lms_lesson_access_overrides', 'lms_lesson_audience_types', 'lms_lesson_audience_users') THEN
    v_lesson_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lesson_id ELSE NEW.lesson_id END;
  END IF;
  IF v_lesson_id IS NOT NULL THEN
    SELECT item_id INTO v_item_id FROM lms_lessons WHERE id = v_lesson_id;
    IF v_item_id IS NOT NULL THEN PERFORM queue_knowledge_review(v_item_id, v_lesson_id); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_review_block AFTER INSERT OR UPDATE OR DELETE ON public.lms_content_blocks
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();
CREATE TRIGGER knowledge_review_quiz AFTER INSERT OR UPDATE OR DELETE ON public.lms_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();
CREATE TRIGGER knowledge_review_video AFTER INSERT OR UPDATE OR DELETE ON public.lms_content_block_videos
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();
CREATE TRIGGER knowledge_review_access AFTER INSERT OR UPDATE OR DELETE ON public.lms_lesson_access_overrides
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();
CREATE TRIGGER knowledge_review_audience_type AFTER INSERT OR UPDATE OR DELETE ON public.lms_lesson_audience_types
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();
CREATE TRIGGER knowledge_review_audience_user AFTER INSERT OR UPDATE OR DELETE ON public.lms_lesson_audience_users
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_review_child_change();

INSERT INTO public.task_types (key, name, description, icon, color, is_system, is_default, is_enabled, position)
VALUES ('knowledge', 'Knowledge Doc', 'A knowledge document page to review', 'file-check', '#0d9488', TRUE, FALSE, TRUE, 8)
ON CONFLICT (key) DO NOTHING;

-- Existing published docs get one whole-document review; individual page
-- tasks begin when those pages change, avoiding a flood on first deployment.
INSERT INTO public.lms_knowledge_review_changes(item_id, page_key, lesson_id)
SELECT i.id, '00000000-0000-0000-0000-000000000000'::uuid, NULL FROM public.lms_items i
WHERE i.track = 'knowledge' AND i.origin_item_id IS NULL AND i.status = 'published'
ON CONFLICT (item_id, page_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
