-- Goals: outcomes that live in their own goal projects and track progress
-- through existing workspace tasks. Tasks are linked, never moved: a task keeps
-- its list, and its dates/status stay the single source of truth everywhere.
--
-- All tables are server-only (RLS on, no anon/authenticated grants). The API
-- resolves workspace membership and task access before every read and write.

create table public.goal_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goal_projects_workspace_idx on public.goal_projects(workspace_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.goal_projects(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 500),
  description text not null default '',
  -- 'achieved' is derived (every included task complete), never stored.
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'on_hold')),
  priority text not null default 'normal' check (priority in ('emergency', 'urgent', 'high', 'normal', 'low', 'none')),
  assignee_ids uuid[] not null default '{}',
  labels text[] not null default '{}',
  work_start_date date,
  work_end_date date,
  start_date date,
  due_date date,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_work_range check (work_end_date is null or work_start_date is null or work_end_date >= work_start_date),
  constraint goals_plan_range check (due_date is null or start_date is null or due_date >= start_date)
);
create index goals_workspace_idx on public.goals(workspace_id);
create index goals_project_idx on public.goals(project_id);

-- One row per task in a goal. is_direct = linked by a person (vs. pulled in by
-- an auto-included folder/list, where the row only anchors timeline placement
-- or a dependency). scheduled = placed on this goal's timeline.
create table public.goal_tasks (
  goal_id uuid not null references public.goals(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  scheduled boolean not null default false,
  is_direct boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (goal_id, task_id)
);
create index goal_tasks_task_idx on public.goal_tasks(task_id);

create table public.goal_dependencies (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  from_task_id uuid not null,
  to_task_id uuid not null,
  from_endpoint text not null default 'end' check (from_endpoint in ('start', 'end')),
  to_endpoint text not null default 'start' check (to_endpoint in ('start', 'end')),
  created_at timestamptz not null default now(),
  check (from_task_id <> to_task_id),
  foreign key (goal_id, from_task_id) references public.goal_tasks(goal_id, task_id) on delete cascade,
  foreign key (goal_id, to_task_id) references public.goal_tasks(goal_id, task_id) on delete cascade,
  unique (goal_id, from_task_id, to_task_id)
);
create index goal_dependencies_goal_idx on public.goal_dependencies(goal_id);

-- Auto-included containers: every task in the folder (including nested
-- folders) or list counts toward the goal, including tasks created later.
create table public.goal_sources (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  resource_type text not null check (resource_type in ('folder', 'list')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (goal_id, resource_type, resource_id)
);
create index goal_sources_goal_idx on public.goal_sources(goal_id);

-- Serialize dependency writes per goal and reject cycles in the database, so
-- two concurrent requests that each passed the API's preflight can't race.
create function public.check_goal_dependency_cycle() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.goals where id = new.goal_id for update;
  if exists (
    with recursive downstream(id) as (
      select new.to_task_id
      union
      select d.to_task_id
      from public.goal_dependencies d
      join downstream x on d.from_task_id = x.id
      where d.goal_id = new.goal_id and d.id <> new.id
    )
    select 1 from downstream where id = new.from_task_id
  ) then
    raise exception 'Dependencies cannot form a cycle';
  end if;
  return new;
end $$;

create trigger goal_dependency_cycle
before insert or update on public.goal_dependencies
for each row execute function public.check_goal_dependency_cycle();

alter table public.goal_projects enable row level security;
alter table public.goals enable row level security;
alter table public.goal_tasks enable row level security;
alter table public.goal_dependencies enable row level security;
alter table public.goal_sources enable row level security;

revoke all on public.goal_projects, public.goals, public.goal_tasks, public.goal_dependencies, public.goal_sources
  from anon, authenticated;
grant select, insert, update, delete
  on public.goal_projects, public.goals, public.goal_tasks, public.goal_dependencies, public.goal_sources
  to service_role;

revoke all on function public.check_goal_dependency_cycle() from public, anon, authenticated;
grant execute on function public.check_goal_dependency_cycle() to service_role;
