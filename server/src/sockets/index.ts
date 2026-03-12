import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { ServerToClientEvents, ClientToServerEvents } from '@squadhub/shared';

// Track online users: userId -> Set of socket IDs
const onlineUsers = new Map<string, Set<string>>();

export function setupSocketIO(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: config.nodeEnv === 'production'
        ? [config.clientUrl, `http://${process.env.VPS_IP || '72.61.245.97'}`]
        : config.clientUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Auth middleware — verify JWT before allowing socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { sub: string };
      (socket as any).userId = decoded.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    console.log(`Socket connected: ${userId} (${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      // First connection — broadcast online status
      io.emit('user_online', { user_id: userId });
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Join workspace room
    socket.on('join_workspace', (workspaceId: string) => {
      socket.join(`workspace:${workspaceId}`);
    });

    // Join a channel room
    socket.on('join_channel', (channelId: string) => {
      socket.join(channelId);
    });

    // Leave a channel room
    socket.on('leave_channel', (channelId: string) => {
      socket.leave(channelId);
    });

    // Typing indicators
    socket.on('typing', (data) => {
      const room = data.channel_id || data.dm_conversation_id;
      if (room) {
        socket.to(room).emit('user_typing', {
          user_id: userId,
          channel_id: data.channel_id,
          dm_conversation_id: data.dm_conversation_id,
        });
      }
    });

    socket.on('stop_typing', (data) => {
      const room = data.channel_id || data.dm_conversation_id;
      if (room) {
        socket.to(room).emit('user_stop_typing', {
          user_id: userId,
          channel_id: data.channel_id,
          dm_conversation_id: data.dm_conversation_id,
        });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${userId} (${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          // Last connection gone — broadcast offline
          io.emit('user_offline', { user_id: userId });
        }
      }
    });
  });

  return io;
}
