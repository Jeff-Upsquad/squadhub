-- ============================================================
-- CRM TeamChat mini apps for SquadHub
-- Embeds the SquadCRM + SquadHireCRM TeamChat modules inside SquadHub as
-- first-class mini-apps with unread badges. Visible to nobody until an admin
-- grants access via Access Control (same as partner-payments).
-- ============================================================

INSERT INTO mini_apps (slug, name, description, icon, is_enabled)
VALUES
  (
    'squadcrm-teamchat',
    'SquadCRM TeamChat',
    'Team discussions on SquadCRM leads, deals and contacts.',
    'chat-bubble-left-right',
    true
  ),
  (
    'squadhire-teamchat',
    'SquadHireCRM TeamChat',
    'Team discussions on SquadHire leads, talent and contacts.',
    'chat-bubble-left-right',
    true
  )
ON CONFLICT (slug) DO NOTHING;
