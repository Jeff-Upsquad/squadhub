-- A requirement card and its CRM delivery request are committed together.
-- The service-only worker retries delivery; CRM receipts make retries safe.
BEGIN;
CREATE TABLE IF NOT EXISTS public.service_brief_crm_outbox (
  card_id uuid PRIMARY KEY REFERENCES public.subscription_cards(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  crm_lead_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_brief_crm_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_brief_crm_outbox FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.service_brief_crm_outbox TO service_role;
CREATE INDEX IF NOT EXISTS service_brief_crm_outbox_pending ON public.service_brief_crm_outbox(next_attempt_at) WHERE delivered_at IS NULL;
CREATE OR REPLACE FUNCTION public.enqueue_content_brief_crm()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE slug text;
BEGIN
  SELECT service_slug INTO slug FROM (VALUES ('Creative Directors','creative_director'),('Copy and Content Writers','copy_content_writer'),('Social Media Managers','social_media_manager'),('Videographers and Photographers','videographer_photographer'),('AI Video and Image Creators','ai_video_image_creator'),('Ads Specialists','ads_specialist')) r(label,service_slug) WHERE label=NEW.service_type;
  IF slug IS NULL OR coalesce(NEW.customer_phone,'')='' THEN
    DELETE FROM service_brief_crm_outbox WHERE card_id=NEW.id;
    RETURN NEW;
  END IF;
  INSERT INTO service_brief_crm_outbox(card_id,payload)
  VALUES(NEW.id,jsonb_build_object('p_card_id',NEW.id,'p_service_slug',slug,'p_contact_name',NEW.customer_name,'p_phone_e164',NEW.customer_phone,'p_email',NEW.customer_email,'p_brand',NEW.brand_name,
    'p_details',jsonb_build_object('brand',NEW.brand_name,'requirement',NEW.requirement_note,'product',NEW.card_type,'currency',NEW.budget_currency,'budget',NEW.client_budget,'tier_pricing',NEW.tier_pricing,'additional_requirements',NEW.additional_requirements,'assignment_details',NEW.assignment_details,'plan',NEW.plan_name,'languages',NEW.target_languages,'location',NEW.customer_location,'voice_url',NEW.requirement_voice_url,'business_note',NEW.notes)))
  ON CONFLICT(card_id) DO UPDATE SET payload=EXCLUDED.payload,attempts=0,delivered_at=NULL,next_attempt_at=now(),last_error=NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_content_brief_crm() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_content_brief_crm() TO service_role;
DROP TRIGGER IF EXISTS enqueue_content_brief_crm ON public.subscription_cards;
CREATE TRIGGER enqueue_content_brief_crm AFTER INSERT OR UPDATE OF service_type,card_type,budget_currency,requirement_note,additional_requirements,customer_phone,customer_email,customer_name,brand_name,client_budget,tier_pricing,assignment_details,plan_name,target_languages,customer_location,requirement_voice_url,notes ON public.subscription_cards FOR EACH ROW EXECUTE FUNCTION public.enqueue_content_brief_crm();
COMMIT;
NOTIFY pgrst,'reload schema';
