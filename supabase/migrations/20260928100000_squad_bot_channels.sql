-- One private team channel per bot. Existing channels are adopted below.
ALTER TABLE public.channels ADD COLUMN squad_bot_id UUID UNIQUE REFERENCES public.squad_bots(id);

-- The bot association is managed by server RPCs, even if a user-scoped
-- Data API client otherwise has permission to create or edit channels.
CREATE FUNCTION public.protect_squad_bot_channel_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND
    ((TG_OP = 'INSERT' AND NEW.squad_bot_id IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND NEW.squad_bot_id IS DISTINCT FROM OLD.squad_bot_id)) THEN
    RAISE EXCEPTION 'Bot channel links are managed by the server';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_squad_bot_channel_link BEFORE INSERT OR UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.protect_squad_bot_channel_link();
REVOKE ALL ON FUNCTION public.protect_squad_bot_channel_link() FROM PUBLIC, anon, authenticated;


CREATE TABLE public.squad_bot_doubts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.squad_bots(id),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 4000),
  context TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  job_id UUID,
  target JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','instructed','executing','taken_over','completed','failed')),
  instruction TEXT,
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  execution_token UUID,
  outcome_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bot_id, event_id),
  FOREIGN KEY(bot_id, job_id) REFERENCES public.squad_bot_jobs(bot_id, id)
);
CREATE INDEX squad_bot_doubts_queue ON public.squad_bot_doubts(bot_id, status, created_at DESC);
CREATE TRIGGER squad_bot_doubts_updated BEFORE UPDATE ON public.squad_bot_doubts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.squad_bot_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.squad_bots(id),
  doubt_id UUID NOT NULL UNIQUE REFERENCES public.squad_bot_doubts(id),
  question TEXT NOT NULL,
  instruction TEXT NOT NULL,
  taught_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX squad_bot_learnings_bot ON public.squad_bot_learnings(bot_id, created_at DESC);
ALTER TABLE public.squad_bot_doubts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_bot_learnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.squad_bot_doubts, public.squad_bot_learnings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.squad_bot_doubts TO service_role;
GRANT SELECT, INSERT ON public.squad_bot_learnings TO service_role;

-- Lock the question so simultaneous replies/takeovers cannot both win. Saving
-- guidance and teaching the bot are a single transaction, before worker pickup.
CREATE FUNCTION public.resolve_squad_bot_doubt(p_id UUID, p_bot_id UUID, p_user_id UUID, p_mode TEXT, p_instruction TEXT)
RETURNS public.squad_bot_doubts LANGUAGE plpgsql SET search_path = public AS $$
DECLARE d public.squad_bot_doubts;
BEGIN
  SELECT * INTO d FROM squad_bot_doubts WHERE id = p_id AND bot_id = p_bot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002'; END IF;
  IF d.status NOT IN ('open','instructed','failed') THEN RAISE EXCEPTION 'This question has already been handled' USING ERRCODE = 'P0001'; END IF;
  IF p_mode NOT IN ('instruct','takeover') OR (p_mode = 'instruct' AND (d.status <> 'open' OR length(trim(coalesce(p_instruction,''))) NOT BETWEEN 1 AND 4000)) THEN
    RAISE EXCEPTION 'Invalid response' USING ERRCODE = 'P0001';
  END IF;
  IF p_mode = 'instruct' THEN
    INSERT INTO squad_bot_learnings(bot_id, doubt_id, question, instruction, taught_by)
    VALUES(d.bot_id, d.id, d.question, trim(p_instruction), p_user_id);
  END IF;
  UPDATE squad_bot_doubts SET status = CASE WHEN p_mode = 'instruct' THEN 'instructed' ELSE 'taken_over' END,
    instruction = CASE WHEN p_mode = 'instruct' THEN trim(p_instruction) ELSE instruction END,
    resolved_by = p_user_id, resolved_at = now()
  WHERE id = d.id RETURNING * INTO d;
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.resolve_squad_bot_doubt(UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_squad_bot_doubt(UUID,UUID,UUID,TEXT,TEXT) TO service_role;

-- Serialize provisioning, including retries and simultaneous admin requests.
CREATE FUNCTION public.ensure_squad_bot_channel(p_bot_id UUID, p_workspace_id UUID, p_user_id UUID)
RETURNS public.channels LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c public.channels; b public.squad_bots;
BEGIN
  SELECT * INTO b FROM squad_bots WHERE id = p_bot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bot not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id AND u.id = p_user_id AND u.user_type = 'internal' AND u.is_admin) THEN
    RAISE EXCEPTION 'An internal workspace admin is required';
  END IF;
  SELECT * INTO c FROM channels WHERE squad_bot_id = p_bot_id;
  IF NOT FOUND THEN
    -- Adopt a pre-created private bot channel only when its creator is an
    -- internal platform admin in the same workspace.
    SELECT ch.* INTO c FROM channels ch JOIN users u ON u.id = ch.created_by
      WHERE ch.workspace_id = p_workspace_id AND ch.name = b.slug AND ch.is_private
        AND ch.deleted_at IS NULL AND ch.squad_bot_id IS NULL AND u.user_type = 'internal' AND u.is_admin
      ORDER BY ch.created_at LIMIT 1;
    IF FOUND THEN
      UPDATE channels SET squad_bot_id = p_bot_id WHERE id = c.id RETURNING * INTO c;
    ELSE
      INSERT INTO channels(workspace_id,name,description,is_private,created_by,squad_bot_id)
      VALUES(p_workspace_id, b.slug || '-' || left(b.id::text,8), 'Questions, guidance and handovers for ' || b.internal_name, true, p_user_id, p_bot_id)
      RETURNING * INTO c;
    END IF;
  END IF;
  IF c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the bot channel before using it'; END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.ensure_squad_bot_channel(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_squad_bot_channel(UUID,UUID,UUID) TO service_role;

-- Attach existing dedicated channels without granting any additional users access.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT b.id AS bot_id, ch.workspace_id, ch.created_by FROM squad_bots b
    JOIN channels ch ON ch.name = b.slug AND ch.is_private AND ch.deleted_at IS NULL
    JOIN users u ON u.id = ch.created_by AND u.is_admin AND u.user_type = 'internal'
    JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ch.workspace_id
    ORDER BY ch.created_at
  LOOP
    PERFORM ensure_squad_bot_channel(r.bot_id, r.workspace_id, r.created_by);
  END LOOP;
END $$;

-- Creating the bot and its channel succeeds or rolls back together.
CREATE FUNCTION public.create_squad_bot_with_channel(p_bot JSONB, p_workspace_id UUID, p_user_id UUID)
RETURNS public.squad_bots LANGUAGE plpgsql SET search_path = public AS $$
DECLARE b public.squad_bots;
BEGIN
  INSERT INTO squad_bots(slug,internal_name,public_name,description,home_app,status,sort_order)
  VALUES(p_bot->>'slug',p_bot->>'internal_name',p_bot->>'public_name',p_bot->>'description',p_bot->>'home_app','off',(p_bot->>'sort_order')::integer)
  RETURNING * INTO b;
  PERFORM ensure_squad_bot_channel(b.id,p_workspace_id,p_user_id);
  RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.create_squad_bot_with_channel(JSONB,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_squad_bot_with_channel(JSONB,UUID,UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
