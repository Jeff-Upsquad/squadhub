-- ============================================================
-- 124: Candidates — recruiting candidate management mini app
-- Surfaces SquadHire's "Candidates" module (the lead_submissions
-- pipeline) inside the web app as a mini app. SquadHub renders a
-- thin UI; all reads/writes proxy to SquadHire over the signed
-- /api/integrations/squadhub/candidates/* surface, gated here by
-- requireMiniAppOrAdmin('candidates'). SquadHire stays the single
-- source of truth — no candidate data is stored in SquadHub.
-- Visible to nobody until an admin grants access via Access Control.
-- ============================================================

INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'candidates',
  'Candidates',
  'Review and manage recruiting candidates: filter by category & status, update status, add notes, archive & restore',
  'identification',
  true
)
ON CONFLICT DO NOTHING;
