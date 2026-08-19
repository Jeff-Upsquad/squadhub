/**
 * One-shot: fill CRM owners on cards the SQL migration couldn't link
 * (email/phone match, missing lead_submission_id).
 *
 *   npx tsx server/src/scripts/backfillCardAssignees.ts
 */
import { backfillUnlinkedCardAssignees } from '../utils/cardCrmAssignees';

backfillUnlinkedCardAssignees()
  .then((counts) => {
    console.log(
      `[backfillCardAssignees] updated ${counts.subscription} subscription/assignment cards, ${counts.job} job cards`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('[backfillCardAssignees] failed', err);
    process.exit(1);
  });
