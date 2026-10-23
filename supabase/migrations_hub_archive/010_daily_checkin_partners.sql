-- ============================================================
-- 010: Daily Check-In Partners Mini App
-- Rename existing check-in to "Teammates", add "Partners" variant
-- ============================================================

-- Rename existing daily check-in mini app
UPDATE mini_apps
SET name = 'Daily Check-In Teammates',
    description = 'Track daily attendance for teammates with configurable checklists per role',
    updated_at = now()
WHERE slug = 'daily-checkin';

-- Seed: Daily Check-In Partners as new mini app
INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES ('daily-checkin-partners', 'Daily Check-In Partners', 'Track daily attendance for partners with configurable checklists per role', 'check-circle', true);
