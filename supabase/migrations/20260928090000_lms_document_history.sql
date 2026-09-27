-- Immutable document snapshots, deliberately outside lms_items/lms_lessons so
-- history cannot enter navigation, search, learner feeds or bot sync payloads.
CREATE TABLE public.lms_item_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.lms_items(id) ON DELETE CASCADE,
  transaction_id BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  change_label TEXT NOT NULL,
  page_title TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE (item_id, transaction_id)
);
CREATE INDEX lms_item_versions_history ON public.lms_item_versions(item_id, changed_at DESC, id DESC);
ALTER TABLE public.lms_item_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lms_item_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lms_item_versions TO service_role;

-- Called only by the triggers below. The item lock serializes writers and the
-- unique key saves one complete pre-change document per database transaction,
-- including bulk block reorders/deletions. Failed writes roll history back too.
CREATE FUNCTION public.capture_lms_item_version(p_item_id UUID, p_label TEXT, p_page_title TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row public.lms_items%ROWTYPE;
  pages JSONB;
BEGIN
  SELECT * INTO item_row FROM public.lms_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.lms_item_versions WHERE item_id = p_item_id AND transaction_id = txid_current()
  ) THEN RETURN; END IF;

  SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('blocks', COALESCE((
    SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object(
      'videos', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.language) FROM public.lms_content_block_videos v WHERE v.block_id = b.id), '[]'::jsonb),
      'quiz_questions', COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position, q.id) FROM public.lms_quiz_questions q WHERE q.block_id = b.id), '[]'::jsonb)
    ) ORDER BY b.position, b.id) FROM public.lms_content_blocks b WHERE b.lesson_id = l.id
  ), '[]'::jsonb)) ORDER BY l.position, l.id)
  INTO pages FROM public.lms_lessons l WHERE l.item_id = p_item_id;
  -- Creating a document's first auto-page is not a revision.
  IF pages IS NULL THEN RETURN; END IF;
  INSERT INTO public.lms_item_versions(item_id, transaction_id, change_label, page_title, snapshot)
  VALUES (p_item_id, txid_current(), p_label, p_page_title,
    jsonb_build_object('document', to_jsonb(item_row) - ARRAY['squadhire_synced_at', 'squadhire_last_error'], 'pages', pages));
END;
$$;

CREATE FUNCTION public.record_lms_content_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_data JSONB;
  old_data JSONB;
  new_data JSONB;
  doc_id UUID;
  page_id UUID;
  page_name TEXT;
  label TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND
    (old_data - ARRAY['updated_at', 'squadhire_synced_at', 'squadhire_last_error', 'review_state', 'review_note', 'submitted_by', 'submitted_at']) =
    (new_data - ARRAY['updated_at', 'squadhire_synced_at', 'squadhire_last_error', 'review_state', 'review_note', 'submitted_by', 'submitted_at']) THEN
    RETURN NEW;
  END IF;
  row_data := COALESCE(old_data, new_data);
  label := CASE TG_TABLE_NAME
    WHEN 'lms_items' THEN 'Document settings changed'
    WHEN 'lms_lessons' THEN 'Page'
    WHEN 'lms_content_blocks' THEN 'Content'
    WHEN 'lms_content_block_videos' THEN 'Video'
    ELSE 'Quiz question' END;
  IF TG_TABLE_NAME = 'lms_items' THEN
    doc_id := (row_data->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'lms_lessons' THEN
    doc_id := (row_data->>'item_id')::uuid;
    page_name := row_data->>'title';
    -- Review approval moves pages from a draft into the original document.
    IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
      PERFORM public.capture_lms_item_version(NEW.item_id, 'Pages replaced', page_name);
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'lms_content_blocks' THEN
      page_id := (row_data->>'lesson_id')::uuid;
    ELSE
      SELECT lesson_id INTO page_id FROM public.lms_content_blocks WHERE id = (row_data->>'block_id')::uuid;
    END IF;
    SELECT item_id, title INTO doc_id, page_name FROM public.lms_lessons WHERE id = page_id;
  END IF;
  IF TG_TABLE_NAME <> 'lms_items' THEN
    label := label || CASE TG_OP WHEN 'INSERT' THEN ' added' WHEN 'DELETE' THEN ' deleted' ELSE ' updated' END;
  END IF;
  PERFORM public.capture_lms_item_version(doc_id, label, page_name);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_lms_item_version(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_lms_content_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lms_items_history BEFORE UPDATE ON public.lms_items
FOR EACH ROW EXECUTE FUNCTION public.record_lms_content_change();
CREATE TRIGGER lms_lessons_history BEFORE INSERT OR UPDATE OR DELETE ON public.lms_lessons
FOR EACH ROW EXECUTE FUNCTION public.record_lms_content_change();
CREATE TRIGGER lms_blocks_history BEFORE INSERT OR UPDATE OR DELETE ON public.lms_content_blocks
FOR EACH ROW EXECUTE FUNCTION public.record_lms_content_change();
CREATE TRIGGER lms_videos_history BEFORE INSERT OR UPDATE OR DELETE ON public.lms_content_block_videos
FOR EACH ROW EXECUTE FUNCTION public.record_lms_content_change();
CREATE TRIGGER lms_quizzes_history BEFORE INSERT OR UPDATE OR DELETE ON public.lms_quiz_questions
FOR EACH ROW EXECUTE FUNCTION public.record_lms_content_change();
NOTIFY pgrst, 'reload schema';
