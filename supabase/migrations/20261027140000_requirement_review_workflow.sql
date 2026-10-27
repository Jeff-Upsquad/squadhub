-- Delivery and human review are independent. Existing cards are not broadcast.
ALTER TABLE public.subscription_cards
  ADD COLUMN business_submitted_at timestamptz,
  ADD COLUMN requirement_reviewed_at timestamptz,
  ADD COLUMN requirement_reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN requirement_reviewer_name text;
ALTER TABLE public.job_cards
  ADD COLUMN business_submitted_at timestamptz,
  ADD COLUMN requirement_reviewed_at timestamptz,
  ADD COLUMN requirement_reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN requirement_reviewer_name text;

CREATE TABLE public.requirement_delivery_queue (
  card_id uuid NOT NULL,
  card_table text NOT NULL CHECK (card_table IN ('subscription_cards','job_cards')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  PRIMARY KEY (card_table, card_id)
);
CREATE INDEX requirement_delivery_queue_ready_idx ON public.requirement_delivery_queue(available_at) WHERE completed_at IS NULL;
ALTER TABLE public.requirement_delivery_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.requirement_delivery_queue FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requirement_delivery_queue TO service_role;

CREATE FUNCTION public.enqueue_business_requirement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.business_submitted_at IS NOT NULL AND
     ((TG_OP = 'INSERT' AND NEW.state IN ('new','draft','onboarding')) OR (TG_OP = 'UPDATE' AND NEW.business_submitted_at IS DISTINCT FROM OLD.business_submitted_at)) THEN
    INSERT INTO requirement_delivery_queue(card_id,card_table)
      VALUES(NEW.id,TG_TABLE_NAME)
      ON CONFLICT(card_table,card_id) DO UPDATE SET requested_at=now(), available_at=now(),
        claimed_at=NULL, completed_at=NULL, attempts=0, last_error=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER enqueue_business_requirement AFTER INSERT OR UPDATE OF business_submitted_at
  ON public.subscription_cards FOR EACH ROW EXECUTE FUNCTION public.enqueue_business_requirement();
CREATE TRIGGER enqueue_business_requirement AFTER INSERT OR UPDATE
  ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.enqueue_business_requirement();

CREATE FUNCTION public.claim_requirement_deliveries() RETURNS SETOF public.requirement_delivery_queue
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE requirement_delivery_queue q SET claimed_at=now(), attempts=q.attempts+1
  WHERE (q.card_table,q.card_id) IN (
    SELECT card_table,card_id FROM requirement_delivery_queue
    WHERE completed_at IS NULL AND available_at<=now()
      AND (claimed_at IS NULL OR claimed_at < now()-interval '10 minutes')
    ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 10
  ) RETURNING q.*;
$$;

-- First review is preserved on repeated clicks. The audit event is committed
-- in the same transaction, and is kept after recall resets the current review.
CREATE FUNCTION public.review_requirement(p_table text,p_id uuid,p_actor uuid,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; stamp timestamptz := now(); event_table text;
BEGIN
  IF p_table NOT IN ('subscription_cards','job_cards') THEN RAISE EXCEPTION 'Invalid card type'; END IF;
  EXECUTE format('SELECT to_jsonb(c) FROM %I c WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',p_table) INTO c USING p_id;
  IF c IS NULL THEN RAISE EXCEPTION 'Card not found'; END IF;
  IF c->>'requirement_reviewed_at' IS NULL THEN
    EXECUTE format('UPDATE %I SET requirement_reviewed_at=$2,requirement_reviewed_by=$3,requirement_reviewer_name=$4 WHERE id=$1',p_table)
      USING p_id,stamp,p_actor,p_name;
    event_table := CASE WHEN p_table='job_cards' THEN 'job_card_events' ELSE 'subscription_card_events' END;
    EXECUTE format('INSERT INTO %I(card_id,event_type,actor_id,actor_type,actor_label,metadata) VALUES($1,$2,$3,$4,$5,$6)',event_table)
      USING p_id,'reviewed',p_actor,'admin',p_name,jsonb_build_object('reviewed_at',stamp);
  END IF;
  EXECUTE format('SELECT to_jsonb(c) FROM %I c WHERE id=$1',p_table) INTO c USING p_id;
  RETURN c;
END; $$;
CREATE FUNCTION public.reset_requirement_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF (NEW.recalled_at IS DISTINCT FROM OLD.recalled_at AND NEW.recalled_at IS NOT NULL) OR (OLD.state IN ('published','assigned') AND NEW.state IN ('draft','onboarding')) THEN
    NEW.requirement_reviewed_at=NULL; NEW.requirement_reviewed_by=NULL; NEW.requirement_reviewer_name=NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER reset_requirement_review BEFORE UPDATE ON public.subscription_cards FOR EACH ROW EXECUTE FUNCTION public.reset_requirement_review();
CREATE TRIGGER reset_requirement_review BEFORE UPDATE ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.reset_requirement_review();
REVOKE ALL ON FUNCTION public.enqueue_business_requirement(), public.claim_requirement_deliveries(),public.review_requirement(text,uuid,uuid,text),public.reset_requirement_review() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_business_requirement(),public.claim_requirement_deliveries(),public.review_requirement(text,uuid,uuid,text),public.reset_requirement_review() TO service_role;

-- Atomic multi-tier publication, including country and region targeting.
CREATE FUNCTION public.publish_requirement_tiers(p_id uuid,p_rows jsonb) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c subscription_cards; row_json jsonb; cols text; vals text; assignments text; ids uuid[] := '{}'; row_id uuid;
BEGIN
  SELECT * INTO c FROM subscription_cards WHERE id=p_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Card not found'; END IF;
  IF c.state='published' THEN
    IF c.brief_group_id IS NULL THEN RETURN ARRAY[c.id]; END IF;
    RETURN ARRAY(SELECT id FROM subscription_cards WHERE brief_group_id=c.brief_group_id);
  END IF;
  IF c.state <> 'draft' THEN RAISE EXCEPTION 'Only draft cards can be published'; END IF;
  IF jsonb_array_length(p_rows)=0 OR (p_rows->0->>'id')::uuid <> p_id THEN RAISE EXCEPTION 'Invalid tier rows'; END IF;
  FOR row_json IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_id := (row_json->>'id')::uuid;
    SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('v.%I',k),',' ORDER BY k),
      string_agg(format('%I=v.%I',k,k),',' ORDER BY k)
      INTO cols,vals,assignments FROM jsonb_object_keys(row_json) k;
    IF row_id=p_id THEN
      EXECUTE format('UPDATE subscription_cards SET %s FROM jsonb_populate_record(NULL::subscription_cards,$1) v WHERE subscription_cards.id=$2',assignments) USING row_json,p_id;
    ELSE
      EXECUTE format('INSERT INTO subscription_cards(%s) SELECT %s FROM jsonb_populate_record(NULL::subscription_cards,$1) v',cols,vals) USING row_json;
      INSERT INTO subscription_card_target_countries(card_id,country_id) SELECT row_id,country_id FROM subscription_card_target_countries WHERE card_id=p_id;
      INSERT INTO subscription_card_target_regions(card_id,country_id,region) SELECT row_id,country_id,region FROM subscription_card_target_regions WHERE card_id=p_id;
    END IF;
    ids := array_append(ids,row_id);
  END LOOP;
  RETURN ids;
END; $$;
REVOKE ALL ON FUNCTION public.publish_requirement_tiers(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_requirement_tiers(uuid,jsonb) TO service_role;

CREATE FUNCTION public.ready_business_job_requirement() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.source IN ('shared_form','landing_page_form') AND NEW.job_profile_id IS NOT NULL
     AND NEW.state IN ('new','onboarding') AND NEW.business_submitted_at IS NULL THEN
    NEW.business_submitted_at=now();
    NEW.state='onboarding';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ready_business_job_requirement BEFORE INSERT OR UPDATE OF job_profile_id
  ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.ready_business_job_requirement();
REVOKE ALL ON FUNCTION public.ready_business_job_requirement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ready_business_job_requirement() TO service_role;
