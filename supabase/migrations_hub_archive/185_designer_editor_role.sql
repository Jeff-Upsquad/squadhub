-- 185_designer_editor_role.sql
-- A role for talents who arrive on a combined "Designer + Editor" subscription
-- card from SquadHire.
--
-- SquadHire talents are provisioned into SquadHub as partners when they open
-- the SquadHub tab, and the card's category picks their role: designer →
-- Designer, video-editor → Video Editor, accountant → Accountant, sales →
-- Sales. The combined card had no counterpart, so it gets one here rather than
-- being squeezed into whichever half we picked arbitrarily.
--
-- It starts as a copy of Designer's permissions — the two crafts share the same
-- surface today, and the role exists so the mapping is one-to-one and can be
-- tuned in the Roles UI later without another migration.

INSERT INTO roles (name, permissions, is_default, color)
SELECT 'Designer + Editor', permissions, false, color
FROM roles
WHERE name = 'Designer'
  AND NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Designer + Editor');
