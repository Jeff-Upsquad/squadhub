import '../../services/squadBotsRuntime';
import * as squadBotChannels from '../../services/squadBotChannels';
import * as squadBots from '../../services/squadBots';
import * as squadBotJobs from '../../services/squadBotJobs';
import { createBotDoubtsRouter } from '@squad-bots/core/routes/integrations/squad-bot-doubts';
export default createBotDoubtsRouter({ squadBots, squadBotJobs, squadBotChannels });
