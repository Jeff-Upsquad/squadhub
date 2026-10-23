-- Bot doubt conversation close state (PR #101 follow-up).
-- The close endpoint previously attempted this update defensively; make it real.
ALTER TABLE public.squad_bot_doubts
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS squad_bot_doubts_closed_idx
  ON public.squad_bot_doubts (bot_id, closed_at DESC);
