import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { query } from "./db.js";
import { readSessionToken, userFromToken, type AuthUser } from "./auth.js";
import { isAllowedOrigin } from "./security.js";

let io: Server | null = null;
const onlineConnections = new Map<string, number>();

export function createRealtimeServer(server: HttpServer) {
  io = new Server(server, {
    cors: config.isProduction ? undefined : { origin: config.appOrigin, credentials: true },
    allowRequest: (request, callback) => callback(null, isAllowedOrigin(request.headers.origin, config.appOrigin))
  });

  io.use(async (socket, next) => {
    try {
      const session = await userFromToken(readSessionToken(socket.handshake.headers.cookie));
      if (!session) return next(new Error("unauthorized"));
      socket.data.user = session;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(`user:${user.id}`);

    const memberships = await query<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
      [user.id]
    );
    const allowedConversations = new Set(memberships.rows.map(({ conversation_id }) => conversation_id));
    socket.data.allowedConversations = allowedConversations;
    memberships.rows.forEach(({ conversation_id }) => socket.join(`conversation:${conversation_id}`));

    const previousCount = onlineConnections.get(user.id) ?? 0;
    onlineConnections.set(user.id, previousCount + 1);
    if (previousCount === 0) io?.emit("presence:update", { userId: user.id, online: true });

    socket.on("conversation:join", async (conversationId: string) => {
      const membership = await query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, user.id]
      );
      if (membership.rowCount) {
        allowedConversations.add(conversationId);
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on("typing:start", (conversationId: string) => {
      if (!allowedConversations.has(conversationId)) return;
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        user: { id: user.id, displayName: user.displayName },
        typing: true
      });
    });

    socket.on("typing:stop", (conversationId: string) => {
      if (!allowedConversations.has(conversationId)) return;
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        user: { id: user.id, displayName: user.displayName },
        typing: false
      });
    });

    socket.on("disconnect", async () => {
      const nextCount = Math.max(0, (onlineConnections.get(user.id) ?? 1) - 1);
      if (nextCount === 0) {
        onlineConnections.delete(user.id);
        await query("UPDATE users SET last_seen_at = now() WHERE id = $1", [user.id]);
        io?.emit("presence:update", { userId: user.id, online: false, lastSeenAt: new Date() });
      } else {
        onlineConnections.set(user.id, nextCount);
      }
    });
  });

  return io;
}

export function emitToConversation(conversationId: string, event: string, payload: unknown) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function joinUserToConversation(userId: string, conversationId: string) {
  if (!io) return;
  const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`) ?? new Set<string>();
  for (const socketId of userRoom) {
    const socket = io.sockets.sockets.get(socketId);
    (socket?.data.allowedConversations as Set<string> | undefined)?.add(conversationId);
    socket?.join(`conversation:${conversationId}`);
  }
}

export function leaveUserFromConversation(userId: string, conversationId: string) {
  if (!io) return;
  const userRoom = io.sockets.adapter.rooms.get(`user:${userId}`) ?? new Set<string>();
  for (const socketId of userRoom) {
    const socket = io.sockets.sockets.get(socketId);
    (socket?.data.allowedConversations as Set<string> | undefined)?.delete(conversationId);
    socket?.leave(`conversation:${conversationId}`);
  }
}

export function onlineUserIds() {
  return [...onlineConnections.keys()];
}
