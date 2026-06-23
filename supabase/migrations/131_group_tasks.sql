-- Group Tasks: a per-container toggle that collapses a container's tasks into a
-- single synthetic row ("Grouped tasks under {name}") on the Home view.
--
-- Containers map to three tables: spaces, folders, lists. ("Area" = a space with
-- a client_id; "client folder" = a folder with folder_type='client' — both are
-- still ordinary spaces/folders, so the flag lives on all three tables.)
--
-- When ON, the container's tasks stop rendering as separate rows on Home's Focus
-- list and dashboard card panels; they fold into one expandable grouped row. The
-- flag is read at render time only — stat-card counts and the in-module list/
-- folder/space views are unaffected. Default false = current behavior preserved.
ALTER TABLE spaces  ADD COLUMN IF NOT EXISTS group_tasks BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS group_tasks BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lists   ADD COLUMN IF NOT EXISTS group_tasks BOOLEAN NOT NULL DEFAULT false;
