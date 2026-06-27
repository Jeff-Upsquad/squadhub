-- 144_design_video_task_types_built_in.sql
--
-- Make the Design Task and Video Edit Task types visible to EVERYONE who can
-- reach a Design / Video Editing space, not just admins.
--
-- Background: these two types are bound to client-space templates, so access is
-- already gated by space membership. Migrations 057 / 071 had demoted them to
-- non-system (is_system = FALSE) to allow field editing, but that also made the
-- /pm/task-types endpoint hide them from non-admins without an explicit
-- task_type_role_access / task_type_user_access grant. The result: non-admins
-- opened the Design/Video task form and saw only the hard-coded Brief + Voice
-- notes, missing the custom brief fields (Type, Ratios, Usage, Audience, ...).
--
-- Promoting them back to is_system = TRUE makes them universally visible (the
-- endpoint short-circuits system types past the access check). Trade-off,
-- chosen deliberately: their brief fields become read-only in the admin UI.

UPDATE public.task_types
   SET is_system = TRUE
 WHERE key IN ('design_task', 'video_edit_task');
