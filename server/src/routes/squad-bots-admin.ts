import '../services/squadBotsRuntime';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { createBotsAdminRouter } from '@squad-bots/core/routes/squad-bots-admin';
export default createBotsAdminRouter({ requireAuth, requireAdmin });
