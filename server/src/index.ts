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
import dmRoutes from './routes/dms';
import uploadRoutes from './routes/upload';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import rolesRoutes from './routes/roles';
import pmSpaceRoutes from './routes/pm/spaces';
import pmFolderRoutes from './routes/pm/folders';
import pmListRoutes from './routes/pm/lists';
import pmTaskRoutes from './routes/pm/tasks';
import pmSharedWithMeRoutes from './routes/pm/shared-with-me';
import favoritesRoutes from './routes/favorites';
import membershipsRoutes from './routes/memberships';
import checkinRoutes from './routes/checkin';
import checkinAdminRoutes from './routes/checkin-admin';
import miniAppsRoutes from './routes/mini-apps';
import miniAppsAdminRoutes from './routes/mini-apps-admin';
import clientsPublicRoutes from './routes/clients-public';
import clientsAdminRoutes from './routes/clients-admin';
import timerRoutes from './routes/timer';
import timerAdminRoutes from './routes/timer-admin';
import invitationsRoutes from './routes/invitations';
import adminPartnersRoutes from './routes/admin-partners';
import customProfilesRoutes from './routes/custom-profiles';
import customProfilesAdminRoutes from './routes/custom-profiles-admin';
import resourceManagementAdminRoutes from './routes/resource-management-admin';
import cashbookRoutes from './routes/cashbook';
import cashbookAdminRoutes from './routes/cashbook-admin';
import cashbookPartnerRoutes from './routes/cashbook-partner';
import clientSpacesRoutes from './routes/client-spaces';
import clientSpacesAdminRoutes from './routes/client-spaces-admin';
import clientAccessAdminRoutes from './routes/client-access-admin';
import taskTypesAdminRoutes from './routes/task-types-admin';
import pmChecklistsRoutes from './routes/pm/checklists';
import { startCheckInCron } from './cron/checkin-cron';
import { startTimerCron } from './cron/timer-cron';

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
  origin: config.nodeEnv === 'production'
    ? [config.clientUrl, config.adminUrl].filter(Boolean)
    : [config.clientUrl, config.adminUrl],
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
app.use('/messages', messageRoutes);
app.use('/dms', dmRoutes);
app.use('/upload', uploadRoutes);
app.use('/users', userRoutes);
app.use('/admin', adminRoutes);
app.use('/admin', rolesRoutes);
app.use('/pm', pmSpaceRoutes);
app.use('/pm', pmFolderRoutes);
app.use('/pm', pmListRoutes);
app.use('/pm', pmTaskRoutes);
app.use('/pm', pmSharedWithMeRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/memberships', membershipsRoutes);
app.use('/checkin', checkinRoutes);
app.use('/admin/checkin', checkinAdminRoutes);
app.use('/mini-apps', miniAppsRoutes);
app.use('/admin/mini-apps', miniAppsAdminRoutes);
app.use('/clients', clientsPublicRoutes);
app.use('/admin/clients', clientsAdminRoutes);
app.use('/timer', timerRoutes);
app.use('/admin/timer', timerAdminRoutes);
app.use('/admin/invitations', invitationsRoutes);
app.use('/admin/partners', adminPartnersRoutes);
app.use('/pm/custom-profiles', customProfilesRoutes);
app.use('/admin/custom-profiles', customProfilesAdminRoutes);
app.use('/admin/resources', resourceManagementAdminRoutes);
app.use('/cashbook', cashbookRoutes);
app.use('/admin/cashbook', cashbookAdminRoutes);
app.use('/partner/cashbook', cashbookPartnerRoutes);
app.use('/client-spaces', clientSpacesRoutes);
app.use('/admin/client-spaces', clientSpacesAdminRoutes);
app.use('/admin/client-access', clientAccessAdminRoutes);
app.use('/admin/task-types', taskTypesAdminRoutes);
app.use('/pm', pmChecklistsRoutes);

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
  console.log(`SquadHub server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);

  // Start cron jobs
  startCheckInCron();
  startTimerCron();
});
