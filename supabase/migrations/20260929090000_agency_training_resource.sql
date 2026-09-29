-- Agencies have their own editable Resources document and delivery audience.
ALTER TABLE public.lms_items
  ADD COLUMN IF NOT EXISTS squadhire_agency_audience BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lms_items_squadhire_agency_audience
  ON public.lms_items(id) WHERE squadhire_agency_audience = TRUE;

COMMENT ON COLUMN public.lms_items.squadhire_agency_audience IS
  'When true, deliver published content to the SquadHire agency training program.';

-- A stable id makes this seed safe across repeat migration runs. It stays a draft
-- until an editor adds pages and publishes it in SquadHub Resources.
INSERT INTO public.lms_items
  (id, kind, track, title, slug, summary, status, squadhire_agency_audience)
VALUES
  ('b4b5e2c1-956d-4c19-a8a7-12d73e601c01', 'post', 'learning',
   'Training Program Agencies', 'training-program-agencies',
   'Agency onboarding and operating procedures', 'draft', TRUE)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
