-- ============================================================
-- 182: rename the Leads mini app to "Requirement Cards"
--
-- Display name only. The slug stays 'leads' because it keys every
-- access grant already handed out AND the server-side gate on every
-- endpoint the three card modules call (requireMiniAppOrAdmin('leads')).
-- Renaming the slug would revoke the app from everyone who has it.
--
-- Same name now appears in the admin sidebar and in Squad CRM, which
-- frames the same module — see 069_crm_requirement_cards_module.sql in
-- the Squad CRM repo.
-- Idempotent: safe to re-run.
-- ============================================================

UPDATE mini_apps
   SET name = 'Requirement Cards'
 WHERE slug = 'leads';
