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
    ? [config.clientUrl, `http://${process.env.VPS_IP || '72.61.245.97'}`]
    : config.clientUrl,
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
});
