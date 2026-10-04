import '../../services/squadBotsRuntime';
import * as squadBotJobs from '../../services/squadBotJobs';
import * as squadBots from '../../services/squadBots';
import { loadPages } from '../../services/squadhireTraining';
import { createBotIntegrationRouter } from '@squad-bots/core/routes/integrations/squad-bots';
export default createBotIntegrationRouter({ loadPages, squadBots, squadBotJobs });
