import { configureSquadBots } from '@squad-bots/core';
import { supabaseAdmin } from '../supabase';
configureSquadBots({ database: supabaseAdmin });
