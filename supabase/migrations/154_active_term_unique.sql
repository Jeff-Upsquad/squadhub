-- 154_active_term_unique.sql
-- One ACTIVE assignment term per (card, recipient). ensureActiveAssignmentTerm
-- is check-then-insert, so two concurrent resumes/finalizes could both insert;
-- this partial unique index makes the second insert fail instead of
-- double-billing. Ended terms (history rows) are unconstrained.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sat_active_card_recipient
  ON subscription_assignment_terms (card_id, recipient_id)
  WHERE status = 'active';
