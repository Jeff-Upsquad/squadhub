-- One knowledge doc can be used by several bots without duplicating content.
-- A separate primary key avoids creating an inferred PostgREST many-to-many
-- embed that would make older clients' direct lms_items → squad_bots join ambiguous.
CREATE TABLE public.squad_bot_knowledge_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.lms_items(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES public.squad_bots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, bot_id)
);
CREATE INDEX squad_bot_knowledge_docs_bot ON public.squad_bot_knowledge_docs(bot_id, item_id);
ALTER TABLE public.squad_bot_knowledge_docs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.squad_bot_knowledge_docs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.squad_bot_knowledge_docs TO service_role;

-- Previously unassigned knowledge was implicitly the hiring bot's.
UPDATE public.lms_items
SET bot_id = (SELECT id FROM public.squad_bots WHERE slug = 'squad-hiring-bot')
WHERE track = 'knowledge' AND origin_item_id IS NULL AND bot_id IS NULL;

INSERT INTO public.squad_bot_knowledge_docs(item_id, bot_id)
SELECT id, bot_id FROM public.lms_items
WHERE track = 'knowledge' AND origin_item_id IS NULL AND bot_id IS NOT NULL;

-- Keep older writers (including SquadHire's approved-answer import) working.
-- bot_id remains a compatibility field; the link table is the full bot list.
CREATE FUNCTION public.sync_knowledge_doc_primary_bot() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.track <> 'knowledge' OR NEW.origin_item_id IS NOT NULL THEN
    DELETE FROM squad_bot_knowledge_docs WHERE item_id = NEW.id;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.bot_id IS DISTINCT FROM NEW.bot_id THEN
      DELETE FROM squad_bot_knowledge_docs WHERE item_id = NEW.id AND bot_id = OLD.bot_id;
    END IF;
  END IF;
  IF NEW.bot_id IS NOT NULL THEN
    INSERT INTO squad_bot_knowledge_docs(item_id, bot_id) VALUES (NEW.id, NEW.bot_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_knowledge_doc_primary_bot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_knowledge_doc_primary_bot() TO service_role;
CREATE TRIGGER lms_items_sync_knowledge_bots
AFTER INSERT OR UPDATE OF bot_id, track, origin_item_id ON public.lms_items
FOR EACH ROW EXECUTE FUNCTION public.sync_knowledge_doc_primary_bot();

-- Replace links in one transaction; an invalid bot cannot leave a doc partly
-- shared. Lock the doc so concurrent edits cannot interleave their bot lists.
CREATE FUNCTION public.set_knowledge_doc_bots(p_item_id UUID, p_bot_ids UUID[])
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  doc public.lms_items%ROWTYPE;
  primary_bot UUID;
BEGIN
  SELECT * INTO doc FROM lms_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR doc.track <> 'knowledge' OR doc.origin_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only original knowledge docs can be shared with bots' USING ERRCODE = '22023';
  END IF;
  IF p_bot_ids IS NULL OR array_position(p_bot_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Bot IDs must be an array of valid IDs' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_bot_ids) AS ids(id) WHERE NOT EXISTS (SELECT 1 FROM squad_bots b WHERE b.id = ids.id)) THEN
    RAISE EXCEPTION 'One or more bots do not exist' USING ERRCODE = '22023';
  END IF;
  primary_bot := CASE WHEN doc.bot_id = ANY(p_bot_ids) THEN doc.bot_id ELSE p_bot_ids[1] END;
  UPDATE lms_items SET bot_id = primary_bot, updated_at = now() WHERE id = p_item_id;
  DELETE FROM squad_bot_knowledge_docs WHERE item_id = p_item_id AND NOT (bot_id = ANY(p_bot_ids));
  INSERT INTO squad_bot_knowledge_docs(item_id, bot_id)
  SELECT p_item_id, id FROM unnest(p_bot_ids) AS ids(id) ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.set_knowledge_doc_bots(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_knowledge_doc_bots(UUID, UUID[]) TO service_role;

COMMENT ON TABLE public.squad_bot_knowledge_docs IS 'Bots allowed to use each original knowledge doc. Content remains in lms_items and its pages.';
NOTIFY pgrst, 'reload schema';
