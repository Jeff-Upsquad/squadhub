import { startTaskRemindersCron } from './cron/task-reminders-cron';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import http from 'http';
import { config, validateConfig } from './config';
import { setupSocketIO } from './sockets';

// Route imports
import authRoutes from './routes/auth';
import workspaceRoutes from './routes/workspaces';
import channelRoutes from './routes/channels';
import messageRoutes from './routes/messages';
import scheduledMessageRoutes from './routes/scheduled-messages';
import dmRoutes from './routes/dms';
import uploadChatWsRoutes from './routes/upload-chat-ws';
import uploadRoutes from './routes/upload';
import userRoutes from './routes/users';
import pmSpaceRoutes from './routes/pm/spaces';
import pmFolderRoutes from './routes/pm/folders';
import pmListRoutes from './routes/pm/lists';
import pmWhiteboardRoutes from './routes/pm/whiteboards';
import pmViewRoutes from './routes/pm/views';
import pmTaskRoutes from './routes/pm/tasks';
import pmLabelsRoutes from './routes/pm/labels';
import pmDayPlansRoutes from './routes/pm/dayPlans';
import pmWorkBlocksRoutes from './routes/pm/workBlocks';
import pmGroupRunsRoutes from './routes/pm/groupRuns';
import pmRoutinesRoutes from './routes/pm/routines';
import pmSharedWithMeRoutes from './routes/pm/shared-with-me';
import pmSearchRoutes from './routes/pm/search';
import pmGoalRoutes from './routes/pm/goals';
import pmPersonalRoutes from './routes/pm/personal';
import favoritesRoutes from './routes/favorites';
import appFavoritesRoutes from './routes/app-favorites';
import notesRoutes from './routes/notes';
import membershipsRoutes from './routes/memberships';
import checkinRoutes from './routes/checkin';
import miniAppsRoutes from './routes/mini-apps';
import timerRoutes from './routes/timer';
import pmStatusGroupsRoutes from './routes/pm/status-groups';
import pmTaskTypeGroupsRoutes from './routes/pm/task-type-groups';
import pmChecklistsRoutes from './routes/pm/checklists';
import pmTaskAttachmentsRoutes from './routes/pm/task-attachments';
import notificationsRoutes from './routes/notifications';
import partnerPushRoutes from './routes/push';
import ssoSquadhireRoutes from './routes/sso-squadhire';
import viewPreferencesRoutes from './routes/view-preferences';
import meetingsRoutes from './routes/meetings';
import meetingEventsRoutes from './routes/meetings_events';
import huddlesRoutes from './routes/huddles';
import featureTipsRoutes from './routes/feature-tips';
import { startCheckInCron } from './cron/checkin-cron';
import { startTimerCron } from './cron/timer-cron';
import { startScheduledMessagesSweeper } from './cron/scheduled-messages-cron';
import { startHuddleSweeper } from './cron/huddle-cron';
import { startRoutineCron } from './cron/routine-cron';
import { startTaskMirrorCron } from './cron/task-mirror-cron';
// Validate env vars before starting
validateConfig();

const app = express();
const server = http.createServer(app);

// Setup Socket.io
const io = setupSocketIO(server);
app.set('io', io); // Make io accessible in route handlers

// Middleware
app.use(helmet());
app.use(cors({
  origin: [config.clientUrl].filter(Boolean),
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/auth', authRoutes);
app.use('/workspaces', workspaceRoutes);
app.use('/channels', channelRoutes);
// Scheduled-message routes mount first: their literal /scheduled paths must
// win over messageRoutes' GET/PATCH/DELETE /:id params.
app.use('/messages', scheduledMessageRoutes);
app.use('/messages', messageRoutes);
app.use('/messages', uploadChatWsRoutes); // adds POST /messages/upload-presign
app.use('/dms', dmRoutes);
app.use('/upload', uploadRoutes);
app.use('/users', userRoutes);
app.use('/pm', pmSpaceRoutes);
app.use('/pm', pmFolderRoutes);
app.use('/pm', pmListRoutes);
app.use('/pm', pmWhiteboardRoutes);
app.use('/pm', pmViewRoutes);
app.use('/pm', pmTaskRoutes);
app.use('/pm', pmLabelsRoutes);
app.use('/pm', pmDayPlansRoutes);
app.use('/pm', pmWorkBlocksRoutes);
app.use('/pm', pmGroupRunsRoutes);
app.use('/pm', pmRoutinesRoutes);
app.use('/pm', pmSharedWithMeRoutes);
app.use('/pm', pmSearchRoutes);
app.use('/pm', pmGoalRoutes);
app.use('/pm', pmPersonalRoutes);
app.use('/pm', pmStatusGroupsRoutes);
app.use('/pm', pmTaskTypeGroupsRoutes);
app.use('/pm', pmChecklistsRoutes);
app.use('/pm', pmTaskAttachmentsRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/app-favorites', appFavoritesRoutes);
app.use('/notes', notesRoutes);
app.use('/memberships', membershipsRoutes);
app.use('/checkin', checkinRoutes);
app.use('/mini-apps', miniAppsRoutes);
app.use('/timer', timerRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/push', partnerPushRoutes);
app.use('/meetings', meetingsRoutes);
app.use('/meeting-events', meetingEventsRoutes);
app.use('/huddles', huddlesRoutes);

// "Sign in with SquadHub" SSO for SquadHire: authorize (browser) + token/directory (server-to-server)
app.use('/sso/squadhire', ssoSquadhireRoutes);

// User view preferences (filters, groupBy, sort — synced across browsers)
app.use('/view-preferences', viewPreferencesRoutes);

// Feature Tips (tooltips / coachmarks). Authoring lives in the Hub admin.
app.use('/feature-tips', featureTipsRoutes);

// Hub-owned data (client cards, partner opportunities/assignments, partner
// payments, support tickets) is served through the Hub bridge — see
// docs/bridge-contract.md. Until the bridge client lands those surfaces answer
// 501 so the kept UI shells render an empty/"coming soon" state.
// TODO(bridge): replace with proxies to HUB_API_URL /bridge/v1/*.
for (const prefix of ['/subscription-cards', '/job-cards', '/partner/opportunities', '/partner/discover', '/partner-payments', '/support']) {
  app.use(prefix, (_req, res) => {
    res.status(501).json({ success: false, error: 'Not available yet: served by Squad Hub via the bridge (docs/bridge-contract.md)' });
  });
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
server.listen(config.port, () => {
  console.log(`Squad Hub SaaS server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);

  // Managed generic-task statuses: load the Task Workflow group into the
  // shared override registry (non-blocking; static catalog is the fallback).
  import('./utils/statusGroups').then((m) => {
    m.loadTaskStatusOverrides();
    setInterval(() => { m.loadTaskStatusOverrides(); }, 60 * 1000);
  }).catch((e) => console.error('[statusGroups] override loader failed:', e));

  // Start cron jobs. Gated by DISABLE_CRONS so a secondary/local instance
  // doesn't double-fire sweeps that send messages, notifications, or spawn routines.
  if (process.env.DISABLE_CRONS === 'true') {
    console.log('Cron jobs disabled (DISABLE_CRONS=true)');
  } else {
    startCheckInCron();
    startTimerCron();
    startScheduledMessagesSweeper(io);
    startHuddleSweeper(io);
    startRoutineCron();
    startTaskRemindersCron();
    startTaskMirrorCron();
  }
});
