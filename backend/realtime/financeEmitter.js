import { getIO } from "../socket/socketServer.js";
import { roomManager } from "../socket/roomManager.js";

/**
 * F-011: payload-free invalidation hint. It carries only WHICH domain changed;
 * clients must refetch authoritative REST state. No amounts, balances or
 * statuses travel over the socket, so a spoofed/duplicated/missed event can
 * never become financial truth. Never throws into a money flow.
 */
export const financeEmitter = {
  invalidate({ userIds = [], admin = true, domain, entityId }) {
    try {
      const io = getIO();
      if (!io) return;
      let target = io;
      for (const id of userIds.filter(Boolean)) target = target.to(roomManager.userRoom(id));
      if (admin) target = target.to(roomManager.adminRoom());
      target.emit("finance:changed", { domain, entityId: entityId ? String(entityId) : undefined, at: Date.now() });
    } catch {
      // best-effort: clients also refetch on reconnect / tab resume
    }
  },
};
