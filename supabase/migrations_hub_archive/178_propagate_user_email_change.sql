-- Propagate account email changes to the denormalized customer-email copies,
-- and hard-link legacy cards to their Hub contact (client_submissions).
--
-- Problem: cards (subscription, assignment, job) and their client/lead rows
-- store the customer's email as plain TEXT snapshots (clients.email,
-- client_submissions.email, subscription_cards.customer_email,
-- job_cards.customer_email). Client-facing lists resolve the logged-in user
-- against those copies; when an admin changes a user's email, only
-- users.email + Supabase Auth were updated, so the copies went stale and the
-- user's cards stopped appearing ("My Cards" count 0).
--
-- Fix:
--   (1) A trigger that keeps the copies in sync whenever users.email changes.
--   (2) A one-time backfill that repairs rows that already drifted, resolved
--       by the universal contact identity (last-10-digit phone suffix) so it
--       works even when the email copies hold the old address.
--   (3) Stamp lead_submission_id on legacy cards (no staged-subscription FK)
--       so the client portal can resolve them id-based.

-- 1. Trigger — propagate users.email changes to the customer-email copies.
CREATE OR REPLACE FUNCTION propagate_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE clients
       SET email = NEW.email
     WHERE lower(trim(email)) = lower(trim(OLD.email))
        OR lower(trim(accounts_email)) = lower(trim(OLD.email));

    UPDATE client_submissions
       SET email = NEW.email
     WHERE lower(trim(email)) = lower(trim(OLD.email))
        OR lower(trim(accounts_email)) = lower(trim(OLD.email));

    -- job cards linked by FK to this user's clients/submissions
    UPDATE job_cards jc
       SET customer_email = NEW.email
      FROM clients c
     WHERE c.id = jc.client_id
       AND lower(trim(c.email)) = lower(trim(OLD.email));

    UPDATE job_cards jc
       SET customer_email = NEW.email
      FROM client_submissions cs
     WHERE cs.id = jc.lead_submission_id
       AND lower(trim(cs.email)) = lower(trim(OLD.email));

    -- subscription cards linked via staged subscriptions
    UPDATE subscription_cards sc
       SET customer_email = NEW.email
      FROM client_submission_subscriptions css
      JOIN clients c ON c.submission_id = css.submission_id
     WHERE css.id = sc.submission_subscription_id
       AND lower(trim(c.email)) = lower(trim(OLD.email));

    -- legacy cards with no FK link, matched by the old email copy
    UPDATE subscription_cards
       SET customer_email = NEW.email
     WHERE lower(trim(customer_email)) = lower(trim(OLD.email));

    UPDATE job_cards
       SET customer_email = NEW.email
     WHERE lower(trim(customer_email)) = lower(trim(OLD.email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_email_propagate ON users;
CREATE TRIGGER trg_users_email_propagate
  AFTER UPDATE OF email ON users
  FOR EACH ROW
  EXECUTE FUNCTION propagate_user_email_change();

-- 2. Backfill — repair rows that drifted before this trigger existed.
--    Resolve each user's contact rows by phone suffix (the universal identity)
--    so the repair works even when the email copies hold the old address.
--    For users with no stored phone, a targeted repair block below handles the
--    known case (the user whose email was changed) keyed by the old email copy.
DO $$
DECLARE
  u RECORD;
  sub RECORD;
  phone_tail TEXT;
BEGIN
  FOR u IN
    SELECT id, lower(trim(email)) AS email, phone
    FROM users
    WHERE email IS NOT NULL AND email <> ''
  LOOP
    phone_tail := NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '\D', '', 'g'), 10), '');

    -- (a) client_submissions matched by the account email OR by phone suffix.
    --     (The OR on phone lets us repair rows whose email copy is stale.)
    UPDATE client_submissions
       SET email = u.email,
           accounts_email = COALESCE(accounts_email, u.email)
     WHERE lower(trim(email)) = u.email
        OR lower(trim(accounts_email)) = u.email
        OR (phone_tail IS NOT NULL
            AND NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(contact_number, ''), '\D', '', 'g'), 10), '') = phone_tail);

    -- (b) clients matched by the account email OR by phone suffix.
    UPDATE clients
       SET email = u.email,
           accounts_email = COALESCE(accounts_email, u.email)
     WHERE lower(trim(email)) = u.email
        OR lower(trim(accounts_email)) = u.email
        OR (phone_tail IS NOT NULL
            AND NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(contact_number, ''), '\D', '', 'g'), 10), '') = phone_tail);

    -- (c) Stamp lead_submission_id on legacy cards: match each submission
    --     belonging to this user, then link cards whose customer_email copy
    --     matches that submission's email (exact). Phone suffix alone is NOT
    --     used here — it's shared across test/sandbox cards and would
    --     misattribute them.
    FOR sub IN
      SELECT id FROM client_submissions
      WHERE lower(trim(email)) = u.email
         OR (phone_tail IS NOT NULL
             AND NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(contact_number, ''), '\D', '', 'g'), 10), '') = phone_tail)
    LOOP
      UPDATE subscription_cards sc
         SET lead_submission_id = sub.id,
             customer_email = u.email
       WHERE sc.lead_submission_id IS NULL
         AND lower(trim(sc.customer_email)) = u.email;

      UPDATE job_cards jc
         SET lead_submission_id = sub.id,
             customer_email = u.email
       WHERE jc.lead_submission_id IS NULL
         AND lower(trim(jc.customer_email)) = u.email;
    END LOOP;
  END LOOP;
END $$;

-- 2b. Targeted repair for the known drifted case: the business user whose
--     account email changed (users.email is the NEW address) but whose
--     client_submissions + legacy cards still hold the OLD address. The old
--     address is matched by phone suffix (9645545553) which is consistent
--     across the submission and all his cards. Guarded to a single row so it
--     never touches unrelated users.
DO $$
DECLARE
  jeff_user UUID := '317302da-5cde-4974-80da-f47dbca49c2e';
  jeff_old_email TEXT := 'jeffzenaone@gmail.com';
  jeff_new_email TEXT;
  jeff_phone_tail TEXT := '9645545553';
  sub_id UUID;
BEGIN
  SELECT lower(trim(email)) INTO jeff_new_email FROM users WHERE id = jeff_user;
  IF jeff_new_email IS NULL OR jeff_new_email = jeff_old_email THEN
    RAISE NOTICE 'Targeted repair skipped — user email not changed or missing';
    RETURN;
  END IF;

  -- Find his client_submissions row by the old email copy + phone.
  SELECT id INTO sub_id FROM client_submissions
   WHERE lower(trim(email)) = jeff_old_email
     AND NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(contact_number, ''), '\D', '', 'g'), 10), '') = jeff_phone_tail
   LIMIT 1;

  IF sub_id IS NULL THEN
    RAISE NOTICE 'Targeted repair skipped — no matching client_submissions';
    RETURN;
  END IF;

  -- Update his submission to the new email.
  UPDATE client_submissions
     SET email = jeff_new_email,
         accounts_email = COALESCE(accounts_email, jeff_new_email)
   WHERE id = sub_id;

  -- Stamp lead_submission_id + new email on his legacy cards. Constrain to
  -- cards whose customer_email copy is EXACTLY the old address — the phone
  -- suffix alone is shared with test cards (jeffzenaone3@gmail.com etc.) that
  -- must not be relabeled.
  UPDATE subscription_cards sc
     SET lead_submission_id = sub_id,
         customer_email = jeff_new_email
   WHERE sc.lead_submission_id IS NULL
     AND lower(trim(sc.customer_email)) = jeff_old_email;

  UPDATE job_cards jc
     SET lead_submission_id = sub_id,
         customer_email = jeff_new_email
   WHERE jc.lead_submission_id IS NULL
     AND lower(trim(jc.customer_email)) = jeff_old_email;
END $$;
