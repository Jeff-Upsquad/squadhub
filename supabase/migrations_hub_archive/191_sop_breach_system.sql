-- ============================================================
-- 191: SOP Breach Enforcement — flags, strikes, per-page rules
--
-- Each SOP page (lms_items where track='sop') and sub-page (lms_lessons)
-- gets an enforcement rule that defines:
--   severity      low | medium | high  (impact level)
--   window_value + window_unit  (time window eg 1 day, 10 days, 3 months, 1 minute)
--   flag_threshold (how many flags within window triggers a strike)
--   strike_points  (points awarded on strike)
--
-- Flags are individual breach reports. When count within window >= threshold,
-- a strike is auto-created for the violating user and they get a notification
-- with a link back to the SOP, flag count, window details and points.
-- ============================================================

-- ------------------------------------------------------------
-- Enforcement rules (one per SOP item or lesson)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sop_enforcement_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lms_lessons(id) ON DELETE CASCADE,
  -- null lesson_id => rule applies to the SOP item/page itself
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  window_value INTEGER NOT NULL DEFAULT 30 CHECK (window_value > 0),
  window_unit TEXT NOT NULL DEFAULT 'day' CHECK (window_unit IN ('minute','hour','day','week','month')),
  flag_threshold INTEGER NOT NULL DEFAULT 3 CHECK (flag_threshold > 0),
  strike_points INTEGER NOT NULL DEFAULT 1 CHECK (strike_points >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_sop_rules_item ON sop_enforcement_rules(item_id);
CREATE INDEX IF NOT EXISTS idx_sop_rules_lesson ON sop_enforcement_rules(lesson_id);

DROP TRIGGER IF EXISTS trg_sop_rules_updated_at ON sop_enforcement_rules;
CREATE TRIGGER trg_sop_rules_updated_at
  BEFORE UPDATE ON sop_enforcement_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Flags — one row per breach report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sop_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES sop_enforcement_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- who broke the SOP
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lms_lessons(id) ON DELETE SET NULL,
  -- optional context: which task or chat message the breach was reported from
  source_kind TEXT CHECK (source_kind IN ('task','message','manual')),
  source_id TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sop_flags_user ON sop_flags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_flags_rule ON sop_flags(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_flags_rule_user ON sop_flags(rule_id, user_id, created_at DESC);

-- ------------------------------------------------------------
-- Strikes — awarded when threshold reached within window
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sop_strikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES sop_enforcement_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 1,
  flag_count INTEGER NOT NULL, -- how many flags triggered this strike
  window_value INTEGER NOT NULL,
  window_unit TEXT NOT NULL,
  severity TEXT NOT NULL,
  flag_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sop_strikes_user ON sop_strikes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_strikes_rule ON sop_strikes(rule_id);

-- Extend notification types for sop flag
-- (notifications.type is TEXT so no migration needed; just documenting expected values: sop_flag, sop_strike)

NOTIFY pgrst, 'reload schema';
