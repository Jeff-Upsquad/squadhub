-- Keep one pre-change snapshot per page touched in a transaction. A page ID is
-- stable across renames and parent/subpage moves; titles are only display text.
ALTER TABLE public.lms_item_versions ADD COLUMN page_id UUID;

-- Older snapshots did not store the changed page ID. Recover it only when the
-- recorded title identifies exactly one page in the pre-change snapshot.
WITH matches AS (
  SELECT v.id, array_agg((p.value->>'id')::uuid) AS ids
  FROM public.lms_item_versions v
  CROSS JOIN LATERAL jsonb_array_elements(v.snapshot->'pages') p(value)
  WHERE v.page_title IS NOT NULL AND v.change_label NOT IN ('Page added', 'Pages replaced')
    AND p.value->>'title' = v.page_title
  GROUP BY v.id
)
UPDATE public.lms_item_versions v SET page_id = m.ids[1]
FROM matches m WHERE v.id = m.id AND cardinality(m.ids) = 1;

-- A newly added page is absent from its pre-change snapshot. Match it against
-- today's pages only if its title is still unique within the document.
WITH matches AS (
  SELECT v.id, array_agg(l.id) AS ids
  FROM public.lms_item_versions v
  JOIN public.lms_lessons l ON l.item_id = v.item_id AND l.title = v.page_title
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v.snapshot->'pages') p
      WHERE p->>'id' = l.id::text
    )
  WHERE v.page_id IS NULL AND v.change_label IN ('Page added', 'Pages replaced')
  GROUP BY v.id
)
UPDATE public.lms_item_versions v SET page_id = m.ids[1]
FROM matches m WHERE v.id = m.id AND cardinality(m.ids) = 1;

ALTER TABLE public.lms_item_versions DROP CONSTRAINT lms_item_versions_item_id_transaction_id_key;
CREATE UNIQUE INDEX lms_item_versions_transaction_page
  ON public.lms_item_versions(item_id, transaction_id, COALESCE(page_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX lms_item_versions_page_history
  ON public.lms_item_versions(item_id, page_id, changed_at DESC, id DESC);

CREATE FUNCTION public.capture_lms_item_version(p_item_id UUID, p_label TEXT, p_page_title TEXT, p_page_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row public.lms_items%ROWTYPE;
  pages JSONB;
BEGIN
  SELECT * INTO item_row FROM public.lms_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.lms_item_versions
    WHERE item_id = p_item_id AND transaction_id = txid_current()
      AND page_id IS NOT DISTINCT FROM p_page_id
  ) THEN RETURN; END IF;

  SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('blocks', COALESCE((
    SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object(
      'videos', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.language) FROM public.lms_content_block_videos v WHERE v.block_id = b.id), '[]'::jsonb),
      'quiz_questions', COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position, q.id) FROM public.lms_quiz_questions q WHERE q.block_id = b.id), '[]'::jsonb)
    ) ORDER BY b.position, b.id) FROM public.lms_content_blocks b WHERE b.lesson_id = l.id
  ), '[]'::jsonb)) ORDER BY l.position, l.id)
  INTO pages FROM public.lms_lessons l WHERE l.item_id = p_item_id;
  IF pages IS NULL THEN RETURN; END IF;
  INSERT INTO public.lms_item_versions(item_id, transaction_id, change_label, page_title, page_id, snapshot)
  VALUES (p_item_id, txid_current(), p_label, p_page_title, p_page_id,
    jsonb_build_object('document', to_jsonb(item_row) - ARRAY['squadhire_synced_at', 'squadhire_last_error'], 'pages', pages));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_lms_content_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_data JSONB;
  old_data JSONB;
  new_data JSONB;
  doc_id UUID;
  page_id UUID;
  page_name TEXT;
  destination_doc_id UUID;
  destination_page_name TEXT;
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
    page_id := (row_data->>'id')::uuid;
    page_name := row_data->>'title';
    IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
      PERFORM public.capture_lms_item_version(NEW.item_id, 'Pages replaced', NEW.title, NEW.id);
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'lms_content_blocks' THEN
      page_id := (row_data->>'lesson_id')::uuid;
      IF TG_OP = 'UPDATE' AND OLD.lesson_id IS DISTINCT FROM NEW.lesson_id THEN
        SELECT item_id, title INTO destination_doc_id, destination_page_name
        FROM public.lms_lessons WHERE id = NEW.lesson_id;
        PERFORM public.capture_lms_item_version(destination_doc_id, 'Content added', destination_page_name, NEW.lesson_id);
      END IF;
    ELSE
      SELECT lesson_id INTO page_id FROM public.lms_content_blocks WHERE id = (row_data->>'block_id')::uuid;
    END IF;
    SELECT item_id, title INTO doc_id, page_name FROM public.lms_lessons WHERE id = page_id;
  END IF;
  IF TG_TABLE_NAME <> 'lms_items' THEN
    label := label || CASE TG_OP WHEN 'INSERT' THEN ' added' WHEN 'DELETE' THEN ' deleted' ELSE ' updated' END;
  END IF;
  PERFORM public.capture_lms_item_version(doc_id, label, page_name, page_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION public.capture_lms_item_version(UUID, TEXT, TEXT);
REVOKE ALL ON FUNCTION public.capture_lms_item_version(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
