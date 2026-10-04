import api from '../../../services/api';
import ManageMembersModal from '../pm/ManageMembersModal';
import { createBotQuestions } from '@squad-bots/core/ui/BotQuestions';
export default createBotQuestions({ api, ManageMembersModal });
