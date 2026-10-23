-- ============================================================
-- 118: Check-Ins — management mini app
-- Surfaces the admin "Daily Check-Ins" module (overview, history,
-- checklists, deadlines, virtual office timing, holidays) inside the
-- web app as a mini app. Endpoints reuse /admin/checkin and
-- /admin/office-timing, gated by requireMiniAppOrAdmin('check-ins').
-- Visible to nobody until an admin grants access via Access Control.
-- ============================================================

INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES (
  'check-ins',
  'Check-Ins',
  'Manage team check-ins: overview, history, checklists, deadlines, virtual office timing & holidays',
  'check-circle',
  true
)
ON CONFLICT DO NOTHING;
