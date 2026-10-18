BEGIN;
CREATE OR REPLACE FUNCTION public.enqueue_content_brief_crm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE slug text;
BEGIN
  SELECT service_slug INTO slug FROM (VALUES ('Creative Directors','creative_director'),('Copy and Content Writers','copy_content_writer'),('Social Media Managers','social_media_manager'),('Videographers and Photographers','videographer_photographer'),('AI Video and Image Creators','ai_video_image_creator'),('Ads Specialists','ads_specialist'),('SEO Specialists','seo_specialist'),('Digital Marketing Teams','digital_marketing_team'),('Influencer Marketing Experts','influencer_marketing'),('Offline Marketing Specialists','offline_marketing'),('Web Developers','web_development'),('App Developers','app_building'),('Automation Specialists','automation'),('Software Developers','software_solutions'),('CFOs and Chartered Accountants','cfo_ca'),('GST Experts','gst_experts'),('TDS Experts','tds_experts'),('Labour Law Experts','labour_law'),('Incorporation and Licensing Specialists','incorporation'),('Contract Drafting Specialists','contract_drafting'),('IP Protection Specialists','ip_protection'),('Compliance Specialists','compliance'),('Business Formation Specialists','business_formation'),('Recruitment Specialists','end_to_end_hiring'),('Team Building Specialists','team_building'),('HR Process Specialists','hr_process'),('Videographers','videographer'),('Photographers','photographer')) r(label,service_slug) WHERE label=NEW.service_type;
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

COMMIT;
NOTIFY pgrst, 'reload schema';
