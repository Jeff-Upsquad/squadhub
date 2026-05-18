-- ============================================================
-- subscription_plans: add monthly_hours and seed defaults
-- ============================================================
-- Companion to migration 065 (daily_hours, weekly_hours).
-- Following the 4-weeks-per-month convention:
--   monthly_hours = weekly_hours x 4 = daily_hours x 5 days x 4 weeks
--
-- Seed values:
--   Starter  -> 20    (1  x 5 x 4)
--   Basic    -> 40    (2  x 5 x 4)
--   Plus     -> 80    (4  x 5 x 4)
--   Pro      -> 120   (6  x 5 x 4)
--   Personal -> 160   (8  x 5 x 4)
--
-- Applies across all 3 subscriptions (designer, video_editor,
-- designer_video_editor) x all 3 tiers (Junior, Pro, Elite) = 45 rows.
-- The column is brand new so every row is set unconditionally.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_hours NUMERIC(5,2);

UPDATE subscription_plans SET monthly_hours = 20  WHERE plan = 'Starter';
UPDATE subscription_plans SET monthly_hours = 40  WHERE plan = 'Basic';
UPDATE subscription_plans SET monthly_hours = 80  WHERE plan = 'Plus';
UPDATE subscription_plans SET monthly_hours = 120 WHERE plan = 'Pro';
UPDATE subscription_plans SET monthly_hours = 160 WHERE plan = 'Personal';
