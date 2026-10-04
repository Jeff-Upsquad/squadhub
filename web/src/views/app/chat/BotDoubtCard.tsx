import api from '../../../services/api';
import { openExternalUrl } from '../../../lib/openExternal';
import { createBotDoubtCard } from '@squad-bots/core/ui/BotDoubtCard';
export default createBotDoubtCard({ api, openExternalUrl });
