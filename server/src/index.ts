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
import adminRoutes from './routes/admin';
import rolesRoutes from './routes/roles';
import pmSpaceRoutes from './routes/pm/spaces';
import pmFolderRoutes from './routes/pm/folders';
import pmListRoutes from './routes/pm/lists';
import pmTaskRoutes from './routes/pm/tasks';
import pmDayPlansRoutes from './routes/pm/dayPlans';
import pmWorkBlocksRoutes from './routes/pm/workBlocks';
import pmRoutinesRoutes from './routes/pm/routines';
import pmSharedWithMeRoutes from './routes/pm/shared-with-me';
import pmSearchRoutes from './routes/pm/search';
import favoritesRoutes from './routes/favorites';
import membershipsRoutes from './routes/memberships';
import checkinRoutes from './routes/checkin';
import checkinAdminRoutes from './routes/checkin-admin';
import offDaysRoutes from './routes/off-days';
import offDaysAdminRoutes from './routes/off-days-admin';
import officeTimingAdminRoutes from './routes/office-timing-admin';
import miniAppsRoutes from './routes/mini-apps';
import miniAppsAdminRoutes from './routes/mini-apps-admin';
import clientsPublicRoutes from './routes/clients-public';
import leadsPublicRoutes from './routes/leads-public';
import clientsAdminRoutes from './routes/clients-admin';
import onboardingLinksRoutes from './routes/onboarding-links';
import onboardingLinksAdminRoutes from './routes/onboarding-links-admin';
import subscriptionCardsRoutes from './routes/subscription-cards';
import subscriptionCardsAdminRoutes from './routes/subscription-cards-admin';
import subscriptionCardsAdminRequestsRoutes from './routes/subscription-cards-admin-requests';
import subscriptionCardsAdminAssignRoutes from './routes/subscription-cards-admin-assign';
import subscriptionCardsAdminSelectRoutes from './routes/subscription-cards-admin-select';
import subscriptionCardsPartnerRoutes from './routes/subscription-cards-partner';
import subscriptionCardsLinkingRoutes from './routes/subscription-cards-linking';
import subscriptionsAdminRoutes from './routes/subscriptions-admin';
import subscriptionAssignmentsAdminRoutes from './routes/subscription-assignments-admin';
import countriesAdminRoutes from './routes/countries-admin';
import grossProfitAdminRoutes from './routes/gross-profit-admin';
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
import pmTaskAttachmentsRoutes from './routes/pm/task-attachments';
import notificationsRoutes from './routes/notifications';
import partnerAppRoutes from './routes/partner-app';
import lmsRoutes from './routes/lms';
import lmsAdminRoutes from './routes/lms-admin';
import chatAppRoutes from './routes/chat/app';
import chatGroupsRoutes from './routes/chat/groups';
import chatMessagesRoutes from './routes/chat/messages';
import chatDmsRoutes from './routes/chat/dms';
import chatReceiptsRoutes from './routes/chat/receipts';
import chatPushRoutes from './routes/chat/push';
import chatUploadRoutes from './routes/chat/upload';
import partnerPushRoutes from './routes/push';
import adminChatGroupsRoutes from './routes/admin/chat-groups';
import adminChatBroadcastsRoutes from './routes/admin/chat-broadcasts';
import adminChatAppConfigRoutes from './routes/admin/chat-app-config';
import squadhireCallbacksRoutes from './routes/integrations/squadhire-callbacks';
import squadhireCategoriesRoutes from './routes/integrations/squadhire-categories';
import subscriptionSquadhireProfilesAdminRoutes from './routes/subscription-squadhire-profiles-admin';
import profileAccessRoutes from './routes/profile-access';
import profileAccessAdminRoutes from './routes/profile-access-admin';
import viewPreferencesRoutes from './routes/view-preferences';
import { startCheckInCron } from './cron/checkin-cron';
import { startTimerCron } from './cron/timer-cron';
import { startScheduledMessagesSweeper } from './cron/scheduled-messages-cron';
import { startRoutineCron } from './cron/routine-cron';
import { startSquadhireSyncSweeper, startManualAssignmentSweeper, startSelectionNotifySweeper, startActivationNotifySweeper, startTalentAcceptedNotifySweeper } from './utils/squadhireWebhook';
import { startProfileAccessGrantsSyncSweeper } from './utils/squadhireGrantsWebhook';

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
  origin: [config.clientUrl, config.adminUrl, config.cashbookUrl, config.desktopUrl].filter(Boolean),
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
app.use('/admin', adminRoutes);
app.use('/admin', rolesRoutes);
app.use('/pm', pmSpaceRoutes);
app.use('/pm', pmFolderRoutes);
app.use('/pm', pmListRoutes);
app.use('/pm', pmTaskRoutes);
app.use('/pm', pmDayPlansRoutes);
app.use('/pm', pmWorkBlocksRoutes);
app.use('/pm', pmRoutinesRoutes);
app.use('/pm', pmSharedWithMeRoutes);
app.use('/pm', pmSearchRoutes);
app.use('/favorites', favoritesRoutes);
app.use('/memberships', membershipsRoutes);
app.use('/checkin', checkinRoutes);
app.use('/admin/checkin', checkinAdminRoutes);
app.use('/off-days', offDaysRoutes);
app.use('/admin/off-days', offDaysAdminRoutes);
app.use('/admin/office-timing', officeTimingAdminRoutes);
app.use('/mini-apps', miniAppsRoutes);
app.use('/admin/mini-apps', miniAppsAdminRoutes);
app.use('/clients', clientsPublicRoutes);
app.use('/leads', leadsPublicRoutes);
app.use('/admin/clients', clientsAdminRoutes);
app.use('/onboarding-links', onboardingLinksRoutes);
app.use('/admin/onboarding-links', onboardingLinksAdminRoutes);
app.use('/subscription-cards', subscriptionCardsRoutes);
app.use('/admin/subscription-cards', subscriptionCardsAdminRoutes);
app.use('/admin', subscriptionCardsAdminRequestsRoutes);
app.use('/admin', subscriptionCardsAdminAssignRoutes);
app.use('/admin', subscriptionCardsAdminSelectRoutes);
app.use('/admin', subscriptionCardsLinkingRoutes);
app.use('/partner/opportunities', subscriptionCardsPartnerRoutes);
app.use('/admin/subscriptions', subscriptionsAdminRoutes);
app.use('/admin/subscription-assignments', subscriptionAssignmentsAdminRoutes);
app.use('/admin/subscriptions', subscriptionSquadhireProfilesAdminRoutes);
app.use('/admin/countries', countriesAdminRoutes);
app.use('/admin/gross-profit', grossProfitAdminRoutes);
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
app.use('/pm', pmTaskAttachmentsRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/push', partnerPushRoutes);
app.use('/partner-app', partnerAppRoutes);
app.use('/lms', lmsRoutes);
app.use('/admin/lms', lmsAdminRoutes);

// Squad Chat
app.use('/chat/app', chatAppRoutes);
app.use('/chat/groups', chatGroupsRoutes);
app.use('/chat/messages', chatMessagesRoutes);
app.use('/chat/dms', chatDmsRoutes);
app.use('/chat/receipts', chatReceiptsRoutes);
app.use('/chat/push', chatPushRoutes);
app.use('/chat/upload', chatUploadRoutes);
app.use('/admin/chat/groups', adminChatGroupsRoutes);
app.use('/admin/chat/broadcasts', adminChatBroadcastsRoutes);
app.use('/admin/chat/app-config', adminChatAppConfigRoutes);

// Integrations — inbound callbacks from sister products (SquadHire etc.)
app.use('/integrations/squadhire', squadhireCallbacksRoutes);
// Admin-facing read-through proxy for SquadHire metadata (categories etc.)
app.use('/admin/integrations/squadhire', squadhireCategoriesRoutes);

// Profile Access — local mirror of SquadHire's talent_access_grants.
app.use('/profile-access', profileAccessRoutes);
app.use('/admin/profile-access', profileAccessAdminRoutes);

// User view preferences (filters, groupBy, sort — synced across browsers)
app.use('/view-preferences', viewPreferencesRoutes);

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
  startScheduledMessagesSweeper(io);
  startRoutineCron();

  // Outbound SquadHire webhook retry sweeper. No-ops when SQUADHIRE_WEBHOOK_URL
  // is unset, so dev environments without SquadHire configured are unaffected.
  startSquadhireSyncSweeper();
  startManualAssignmentSweeper();
  startSelectionNotifySweeper();
  startActivationNotifySweeper();
  startTalentAcceptedNotifySweeper();
  startProfileAccessGrantsSyncSweeper();
});
