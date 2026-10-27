-- Isolated PostgreSQL fixture. Run only in a new disposable database.
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE users(id uuid primary key);
CREATE TABLE subscription_cards(id uuid primary key default gen_random_uuid(),state text not null default 'new',source text,brief_group_id uuid,deleted_at timestamptz,recalled_at timestamptz,published_by uuid,published_at timestamptz,target_tiers text[],plan_snapshot jsonb);
CREATE TABLE job_cards(LIKE subscription_cards INCLUDING ALL);
ALTER TABLE job_cards ADD COLUMN job_profile_id uuid;
CREATE TABLE subscription_card_events(id uuid primary key default gen_random_uuid(),card_id uuid references subscription_cards(id),event_type text,actor_id text,actor_type text,actor_label text,metadata jsonb);
CREATE TABLE job_card_events(id uuid primary key default gen_random_uuid(),card_id uuid references job_cards(id),event_type text,actor_id text,actor_type text,actor_label text,metadata jsonb);
CREATE TABLE subscription_card_target_countries(card_id uuid references subscription_cards(id),country_id uuid);
CREATE TABLE subscription_card_target_regions(card_id uuid references subscription_cards(id),country_id uuid,region text);

\ir ../../../supabase/migrations/20261027140000_requirement_review_workflow.sql
\ir requirementWorkflow.sql
