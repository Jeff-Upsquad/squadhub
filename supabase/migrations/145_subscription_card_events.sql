-- 145_subscription_card_events.sql
-- Append-only activity log for subscription cards. One row per lifecycle
-- transition (created, draft_saved, published, soft_published, broadcast,
-- recipient_accepted/declined, recalled, cancelled, archived, republished,
-- assigned). Read-only feed surfaced as a timeline in the admin card editor.
--
-- actor_id is intentionally FK-free and TEXT: it may hold an internal user id
-- (admin/partner) OR an external SquadHire talent id, disambiguated by
-- actor_type. actor_label is a display-name snapshot taken at write time so the
-- feed renders without extra joins (and survives the actor being renamed).

create table if not exists subscription_card_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references subscription_cards(id) on delete cascade,
  event_type text not null,
  actor_id text,
  actor_type text check (actor_type in ('admin', 'partner', 'talent', 'system')),
  actor_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscription_card_events_card
  on subscription_card_events (card_id, created_at);
