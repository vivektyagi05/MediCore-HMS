import OnlineSession from "../models/OnlineSession.js";
import { ADMIN_ROLES } from "../constants/roles.js";
import { roomManager } from "./roomManager.js";

const activeUsers = new Map();

const serializePresence = (userId, status = "online") => ({
  userId: userId.toString(),
  status,
  activeConnections: activeUsers.get(userId.toString())?.size || 0,
  lastActiveAt: new Date(),
});

export const presenceManager = {
  // Called once at server startup (see backend/server.js), after the DB
  // connects and before any socket can connect. The in-memory activeUsers
  // map above is empty at this point in the process's life, so any
  // OnlineSession document still marked "online" is necessarily left over
  // from a previous process — its socket cannot exist here. See
  // presenceQuery.js's header for the full root-cause explanation.
  async reconcileOnBoot() {
    const result = await OnlineSession.updateMany(
      { status: "online" },
      { status: "offline", disconnectedAt: new Date() },
    );
    return result.modifiedCount ?? result.nModified ?? 0;
  },

  async markOnline(io, socket) {
    const userId = socket.user._id.toString();
    const sessions = activeUsers.get(userId) || new Set();
    sessions.add(socket.id);
    activeUsers.set(userId, sessions);

    await OnlineSession.findOneAndUpdate(
      { socketId: socket.id },
      {
        socketId: socket.id,
        userId: socket.user._id,
        role: socket.user.role,
        status: "online",
        connectedAt: new Date(),
        lastActiveAt: new Date(),
        ipAddress: socket.session.ipAddress,
        userAgent: socket.session.userAgent,
      },
      { upsert: true, returnDocument: "after" },
    );

    io.to(roomManager.roleRoom("admin")).emit("presence:update", serializePresence(userId));
    return serializePresence(userId);
  },

  async markOffline(io, socket) {
    const userId = socket.user?._id?.toString();
    if (!userId) return;

    const sessions = activeUsers.get(userId);
    if (sessions) {
      sessions.delete(socket.id);
      if (!sessions.size) activeUsers.delete(userId);
    }

    await OnlineSession.findOneAndUpdate(
      { socketId: socket.id },
      { status: "offline", disconnectedAt: new Date(), lastActiveAt: new Date() },
    );

    if (!activeUsers.has(userId)) {
      socket.to(roomManager.roleRoom("admin")).emit("presence:update", serializePresence(userId, "offline"));
    }
  },

  async heartbeat(socket) {
    await OnlineSession.findOneAndUpdate({ socketId: socket.id }, { lastActiveAt: new Date() });
  },

  isOnline(userId) {
    return activeUsers.has(userId.toString());
  },

  snapshot() {
    return [...activeUsers.keys()].map((userId) => serializePresence(userId));
  },

  // Every online user's id was previously sent to every authenticated
  // client, regardless of role (socket:ready payload and GET
  // /realtime/presence both did this). A patient or doctor has no
  // legitimate reason to see who else on the platform is online; only
  // support/ops (super_admin) does. Non-admin roles get an empty list.
  snapshotFor(user) {
    return ADMIN_ROLES.includes(user?.role) ? this.snapshot() : [];
  },
};
