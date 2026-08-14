-- Propagate account email changes to the denormalized customer-email copies.
--
-- Problem: cards (subscription, assignment, job) and their client/lead rows
-- store the customer's email as plain TEXT snapshots (clients.email,
-- client_submissions.email, subscription_cards.customer_email,
-- job_cards.customer_email). Client-facing lists such as GET /job-cards/mine
-- resolve the logged-in user by matching the account email against those
-- copies. When an admin changes a user's email, only users.email + Supabase
-- Auth were updated, so the copies went stale and the user's cards stopped
-- appearing ("My Cards" count 0).
--
-- Fix: (1) a trigger that keeps the copies in sync whenever users.email
-- changes, and (2) a one-time backfill that repairs any rows that already
-- drifted (e.g. the user who changed their email before this migration).

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
-- For every users row, align the denormalized copies to the account email.
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN
    SELECT id, lower(trim(email)) AS email
    FROM users
    WHERE email IS NOT NULL AND email <> ''
  LOOP
    -- clients + their submissions, matched by the email copy
    UPDATE clients
       SET email = u.email,
           accounts_email = COALESCE(accounts_email, u.email)
     WHERE lower(trim(email)) = u.email
        OR lower(trim(accounts_email)) = u.email;

    UPDATE client_submissions
       SET email = u.email,
           accounts_email = COALESCE(accounts_email, u.email)
     WHERE lower(trim(email)) = u.email
        OR lower(trim(accounts_email)) = u.email;

    -- job cards linked by FK to this user's clients/submissions (id-based, safe)
    UPDATE job_cards jc
       SET customer_email = u.email
      FROM clients c
     WHERE c.id = jc.client_id
       AND lower(trim(c.email)) = u.email;

    UPDATE job_cards jc
       SET customer_email = u.email
      FROM client_submissions cs
     WHERE cs.id = jc.lead_submission_id
       AND lower(trim(cs.email)) = u.email;

    -- subscription cards linked via staged subscriptions
    UPDATE subscription_cards sc
       SET customer_email = u.email
      FROM client_submission_subscriptions css
      JOIN clients c ON c.submission_id = css.submission_id
     WHERE css.id = sc.submission_subscription_id
       AND lower(trim(c.email)) = u.email;

    -- legacy cards with no FK link, matched by the old email copy
    UPDATE subscription_cards
       SET customer_email = u.email
     WHERE lower(trim(customer_email)) = u.email;

    UPDATE job_cards
       SET customer_email = u.email
     WHERE lower(trim(customer_email)) = u.email;
  END LOOP;
END $$;
