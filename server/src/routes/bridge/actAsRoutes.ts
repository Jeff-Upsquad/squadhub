// The real Hub routers the bridge act-as passthrough (./actAs.ts) may reach,
// mounted at the same paths (and in the same order) as in src/index.ts. Only
// routers holding allowlisted endpoints belong here; the allowlist in actAs.ts
// is still checked first.
import { Router } from 'express';
import lmsCollabRoutes from '../lms-collab';
import lmsRoutes from '../lms';
import offDaysRoutes from '../off-days';
import subscriptionCardsPartnerRoutes from '../subscription-cards-partner';
import discoverPartnerRoutes from '../discover-partner';
import partnerTalentRoutes from '../partner-talent';

const inner = Router();
inner.use('/lms/collab', lmsCollabRoutes);
inner.use('/lms', lmsRoutes);
inner.use('/off-days', offDaysRoutes);
inner.use('/partner/opportunities', subscriptionCardsPartnerRoutes);
inner.use('/partner/discover', discoverPartnerRoutes);
inner.use('/partner/talent', partnerTalentRoutes);

export default inner;
