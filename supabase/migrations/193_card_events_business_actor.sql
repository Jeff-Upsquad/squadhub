-- Allow Client-view activity to name the business (their own SquadHire
-- portal) separately from a SquadHub operator acting on their behalf.

alter table subscription_card_events
  drop constraint if exists subscription_card_events_actor_type_check;

alter table subscription_card_events
  add constraint subscription_card_events_actor_type_check
  check (actor_type is null or actor_type in ('admin', 'partner', 'talent', 'system', 'business'));
