-- Projects: one workspace-scoped project entity shared by the PM containers
-- (spaces = Areas, folders = Spaces, lists) and Goals.
--
-- goals.project_id is repointed here from goal_projects to projects (ids are
-- preserved during backfill), so existing goal project selections keep working.
-- A task's project is derived from its container chain (nearest-wins:
-- list -> folder -> space) — no per-task column.
--
-- Server-only like the goals tables: RLS on, no anon/authenticated grants.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description text not null default '',
  -- 'inactive' = archived (hidden from pickers); 'active' is the normal state.
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_workspace_idx on public.projects(workspace_id);
create index projects_deleted_at_idx on public.projects(deleted_at);

-- Migrate the goals-only project list into the shared table, keeping ids so
-- goals.project_id and any client-side remembered selections stay valid.
insert into public.projects (id, workspace_id, name, color, description, created_by, created_at, updated_at)
select p.id, p.workspace_id, p.name, p.color, '', p.created_by, p.created_at, p.updated_at
from public.goal_projects p
on conflict (id) do nothing;

alter table public.goals drop constraint if exists goals_project_id_fkey;
alter table public.goals
  add constraint goals_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete cascade;

drop table if exists public.goal_projects;

-- Containers: the project a container's tasks belong to. Nearest container
-- wins, so a folder can override its area and a list its folder. Deleting a
-- project detaches its containers (SET NULL) rather than cascading.
alter table public.spaces add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.folders add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.lists add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists spaces_project_id_idx on public.spaces(project_id);
create index if not exists folders_project_id_idx on public.folders(project_id);
create index if not exists lists_project_id_idx on public.lists(project_id);

alter table public.projects enable row level security;

revoke all on public.projects from anon, authenticated;
grant select, insert, update, delete on public.projects to service_role;
