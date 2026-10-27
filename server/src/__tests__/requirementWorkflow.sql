-- Run only against a disposable database with the fixture and migration applied.
BEGIN;
DO $$
DECLARE business uuid:=gen_random_uuid(); manual uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid(); public_job uuid:=gen_random_uuid(); country uuid:=gen_random_uuid(); first_review jsonb; second_review jsonb; result uuid[]; n int;
BEGIN
 INSERT INTO users(id) VALUES(actor),(other_actor);
 INSERT INTO subscription_cards(id,state,source) VALUES(business,'new','shared_form'),(manual,'draft','internal_brief');
 IF EXISTS(SELECT FROM requirement_delivery_queue) THEN RAISE EXCEPTION 'Incomplete/manual cards must not enqueue'; END IF;
 UPDATE subscription_cards SET business_submitted_at=now() WHERE id=business;
 IF (SELECT count(*) FROM requirement_delivery_queue)<>1 THEN RAISE EXCEPTION 'Submission must enqueue exactly once'; END IF;
 PERFORM claim_requirement_deliveries();
 IF (SELECT count(*) FROM claim_requirement_deliveries())<>0 THEN RAISE EXCEPTION 'Claim must exclude leased work'; END IF;
 IF (SELECT attempts FROM requirement_delivery_queue WHERE card_id=business)<>1 THEN RAISE EXCEPTION 'Attempt not recorded'; END IF;
 UPDATE requirement_delivery_queue SET claimed_at=now()-interval '11 minutes' WHERE card_id=business;
 IF (SELECT count(*) FROM claim_requirement_deliveries())<>1 THEN RAISE EXCEPTION 'Expired claim must recover after restart'; END IF;
 first_review:=review_requirement('subscription_cards',business,actor,'First Reviewer');
 second_review:=review_requirement('subscription_cards',business,other_actor,'Second Reviewer');
 IF first_review->>'requirement_reviewed_at' IS DISTINCT FROM second_review->>'requirement_reviewed_at' OR second_review->>'requirement_reviewed_by'<>actor::text THEN RAISE EXCEPTION 'Repeat review overwrote original'; END IF;
 IF (SELECT count(*) FROM subscription_card_events WHERE card_id=business AND event_type='reviewed')<>1 THEN RAISE EXCEPTION 'Review audit duplicated'; END IF;
 UPDATE subscription_cards SET recalled_at=now(),state='draft' WHERE id=business;
 IF (SELECT requirement_reviewed_at FROM subscription_cards WHERE id=business) IS NOT NULL THEN RAISE EXCEPTION 'Recall did not reset review'; END IF;
 IF NOT EXISTS(SELECT FROM subscription_card_events WHERE actor_id=actor::text) THEN RAISE EXCEPTION 'Recall erased audit'; END IF;
 INSERT INTO job_cards(id,state,source) VALUES(job,'published','internal_brief');
 PERFORM review_requirement('job_cards',job,actor,'Hiring Reviewer');
 IF NOT EXISTS(SELECT FROM job_card_events WHERE card_id=job AND actor_id=actor::text) THEN RAISE EXCEPTION 'Hiring review not audited'; END IF;
 UPDATE job_cards SET recalled_at=now(),state='onboarding' WHERE id=job;
 IF (SELECT requirement_reviewed_at FROM job_cards WHERE id=job) IS NOT NULL THEN RAISE EXCEPTION 'Hiring recall did not reset review'; END IF;
 INSERT INTO job_cards(id,state,source) VALUES(public_job,'new','shared_form');
 IF EXISTS(SELECT FROM requirement_delivery_queue WHERE card_id=public_job) THEN RAISE EXCEPTION 'Incomplete hiring brief enqueued'; END IF;
 UPDATE job_cards SET job_profile_id=gen_random_uuid() WHERE id=public_job;
 IF NOT EXISTS(SELECT FROM requirement_delivery_queue WHERE card_id=public_job AND card_table='job_cards') THEN RAISE EXCEPTION 'Complete business hiring brief did not enqueue'; END IF;
 IF (SELECT state FROM job_cards WHERE id=public_job)<>'onboarding' THEN RAISE EXCEPTION 'Complete business hiring brief not ready for automatic publishing'; END IF;
 -- A failed sibling write rolls back the original publication too.
 BEGIN
   PERFORM publish_requirement_tiers(manual,jsonb_build_array(jsonb_build_object('id',manual,'state','published'),jsonb_build_object('id',sibling,'state',null)));
   RAISE EXCEPTION 'Expected failed publication';
 EXCEPTION WHEN not_null_violation THEN NULL;
 END;
 IF (SELECT state FROM subscription_cards WHERE id=manual)<>'draft' THEN RAISE EXCEPTION 'Partial publication leaked'; END IF;
 INSERT INTO subscription_card_target_countries VALUES(manual,country);
 INSERT INTO subscription_card_target_regions VALUES(manual,country,'Kerala');
 result:=publish_requirement_tiers(manual,jsonb_build_array(jsonb_build_object('id',manual,'state','published','brief_group_id',business),jsonb_build_object('id',sibling,'state','published','brief_group_id',business)));
 IF cardinality(result)<>2 THEN RAISE EXCEPTION 'Tier fanout incomplete'; END IF;
 IF NOT EXISTS(SELECT FROM subscription_card_target_regions WHERE card_id=sibling AND region='Kerala') THEN RAISE EXCEPTION 'Sibling targeting lost'; END IF;
 result:=publish_requirement_tiers(manual,jsonb_build_array(jsonb_build_object('id',manual,'state','published'),jsonb_build_object('id',gen_random_uuid(),'state','published')));
 IF cardinality(result)<>2 OR (SELECT count(*) FROM subscription_cards WHERE brief_group_id=business)<>2 THEN RAISE EXCEPTION 'Retry duplicated siblings'; END IF;
 IF has_function_privilege('authenticated','review_requirement(text,uuid,uuid,text)','EXECUTE') OR has_table_privilege('anon','requirement_delivery_queue','SELECT') THEN RAISE EXCEPTION 'Private workflow exposed'; END IF;
 RAISE NOTICE 'All requirement workflow SQL assertions passed';
END $$;
ROLLBACK;
