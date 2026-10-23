-- ============================================================
-- Software Development Task Type Group
-- Adds new task types for Software Development:
-- 1. Coding
-- 2. Testing
-- 3. UI Designing
-- ============================================================

INSERT INTO task_types (key, name, description, group_name, icon, color, position, is_default, is_system, is_enabled)
VALUES
  ('coding', 'Coding', 'Software engineering, feature implementation, and bug fixing.', 'Software Development', 'code', '#0ea5e9', 110, FALSE, TRUE, TRUE),
  ('testing', 'Testing', 'Writing and executing tests, QA verification, and bug validation.', 'Software Development', 'test-tube', '#10b981', 111, FALSE, TRUE, TRUE),
  ('ui_designing', 'UI Designing', 'User interface design, wireframes, and prototyping.', 'Software Development', 'layout', '#8b5cf6', 112, FALSE, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  position = EXCLUDED.position,
  is_system = EXCLUDED.is_system,
  is_enabled = EXCLUDED.is_enabled;

NOTIFY pgrst, 'reload schema';
