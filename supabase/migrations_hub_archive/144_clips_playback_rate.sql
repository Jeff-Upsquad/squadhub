-- ============================================================
-- 144: Squad Clips — default playback speed for share links.
-- Owner-set starting speed for a clip's public link and Learning
-- embed; NULL = normal (1×). Viewers can still change speed while
-- watching — this only sets where playback starts. Table owned by
-- the Squad Clips app (service role); RLS unaffected.
-- ============================================================

ALTER TABLE clips ADD COLUMN IF NOT EXISTS playback_rate REAL;
