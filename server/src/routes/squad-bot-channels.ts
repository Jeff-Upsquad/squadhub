import '../services/squadBotsRuntime';
import { requireAuth } from '../middleware/auth';
import { checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { createBotChannelsRouter } from '@squad-bots/core/routes/squad-bot-channels';
export default createBotChannelsRouter({ requireAuth, checkResourceAccess, meetsAccessLevel });
