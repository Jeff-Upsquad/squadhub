-- ============================================================
-- Round subscription plan daily_hours to whole numbers
-- ============================================================
-- Migration 065 seeded daily_hours as 1, 2.5, 4.5, 6.5, 8 for
-- Starter/Basic/Plus/Pro/Personal. We're rounding the middle three
-- to clean whole numbers (2, 4, 6) so admin-facing hours are tidy.
-- weekly_hours (5, 10, 20, 30, 40) is already correct and untouched.
--
-- Applies to all 3 subscriptions (designer, video_editor,
-- designer_video_editor) x all 3 tiers (Junior, Pro, Elite) = 45 rows.
-- Unconditional overwrite: any custom admin values are replaced.

UPDATE subscription_plans SET daily_hours = 2 WHERE plan = 'Basic';
UPDATE subscription_plans SET daily_hours = 4 WHERE plan = 'Plus';
UPDATE subscription_plans SET daily_hours = 6 WHERE plan = 'Pro';
