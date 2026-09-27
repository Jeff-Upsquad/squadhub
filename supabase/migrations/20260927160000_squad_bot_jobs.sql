-- Jobs are configured here and executed by each bot's connected application.
CREATE TABLE public.squad_bot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.squad_bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('conversation', 'action')),
  instructions TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'any' CHECK (audience IN ('any', 'candidates', 'customers')),
  person_ids TEXT[] NOT NULL DEFAULT '{}',
  pipeline_id TEXT,
  stage_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, id),
  CHECK (stage_id IS NULL OR pipeline_id IS NOT NULL)
);
CREATE INDEX squad_bot_jobs_bot ON public.squad_bot_jobs(bot_id);
CREATE TRIGGER squad_bot_jobs_updated_at BEFORE UPDATE ON public.squad_bot_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE public.squad_bot_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.squad_bots(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  job_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'failed', 'skipped', 'drafted')),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  target_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (bot_id, job_id) REFERENCES public.squad_bot_jobs(bot_id, id),
  UNIQUE (bot_id, event_id)
);
CREATE INDEX squad_bot_activity_time ON public.squad_bot_activity(bot_id, created_at DESC, id);
CREATE INDEX squad_bot_activity_job_time ON public.squad_bot_activity(bot_id, job_id, created_at DESC);
ALTER TABLE public.squad_bot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squad_bot_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.squad_bot_jobs, public.squad_bot_activity FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.squad_bot_jobs TO service_role;
GRANT SELECT, INSERT ON public.squad_bot_activity TO service_role;

-- Aggregate in the database, unaffected by the Data API's row limit.
CREATE FUNCTION public.squad_bot_activity_summary(p_bot_id UUID, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_job_id UUID DEFAULT NULL)
RETURNS TABLE(job_id UUID, completed BIGINT, failed BIGINT, skipped BIGINT, drafted BIGINT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.job_id,
    count(*) FILTER (WHERE outcome = 'completed'),
    count(*) FILTER (WHERE outcome = 'failed'),
    count(*) FILTER (WHERE outcome = 'skipped'),
    count(*) FILTER (WHERE outcome = 'drafted')
  FROM public.squad_bot_activity a
  WHERE a.bot_id = p_bot_id AND a.created_at >= p_start AND a.created_at < p_end
    AND (p_job_id IS NULL OR a.job_id = p_job_id)
  GROUP BY a.job_id;
$$;
REVOKE ALL ON FUNCTION public.squad_bot_activity_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.squad_bot_activity_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
