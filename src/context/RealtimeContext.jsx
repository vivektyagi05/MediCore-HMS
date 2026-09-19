import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getApiErrorMessage } from "../api/axios";
import { realtimeApi } from "../api/realtimeApi";
import { SOCKET_EVENTS } from "../socket/socketEvents";
import { connectSocket, disconnectSocket } from "../socket/socketClient";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

const RealtimeContext = createContext(null);

export function RealtimeProvider({ children }) {
  const { token, isAuthenticated } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("offline");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [dashboardSyncTick, setDashboardSyncTick] = useState(0);
  const [topAnnouncement, setTopAnnouncement] = useState(null);
  const notificationIdsRef = useRef(new Set());

  const loadNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await realtimeApi.getNotifications({ limit: 25 });
      const nextNotifications = response.data.notifications || [];
      setNotifications(nextNotifications);
      notificationIdsRef.current = new Set(nextNotifications.map((notification) => notification._id));
      setUnreadCount(response.data.unreadCount || 0);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }, [isAuthenticated, toast]);

  const loadPresence = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await realtimeApi.getPresence();
      setOnlineUsers(response.data.onlineUsers || []);
    } catch {
      setOnlineUsers([]);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectSocket();
      setSocket(null);
      setConnectionStatus("offline");
      setNotifications([]);
      notificationIdsRef.current.clear();
      setUnreadCount(0);
      setTopAnnouncement(null);
      return undefined;
    }

    const activeSocket = connectSocket(token);
    setSocket(activeSocket);
    setConnectionStatus(activeSocket.connected ? "online" : "connecting");

    // Initial REST hydration is started immediately so persisted notifications
    // remain available even when the socket handshake is slow/unavailable.
    // The first socket `connect` event must not repeat those same reads; only
    // a genuine reconnect needs a fresh persisted-state sync.
    loadNotifications();
    loadPresence();
    let initialConnection = true;

    const onConnect = () => {
      setConnectionStatus("online");
      if (initialConnection) {
        initialConnection = false;
        return;
      }
      loadNotifications();
      loadPresence();
    };
    const onDisconnect = () => setConnectionStatus("offline");
    // PHASE 2-D — previously swallowed the reason entirely, so a rejected
    // handshake (expired token, server-side auth failure, CORS mismatch)
    // was invisible here and only ever showed up as "connection closes
    // before establishment" in the browser's network panel with no
    // indication why. Surfacing err.message makes the actual cause
    // visible during development/debugging without changing behavior.
    const onConnectError = (err) => {
      setConnectionStatus("error");
      if (!import.meta.env.PROD) {
        console.warn("Realtime socket connection failed:", err?.message);
      }
    };
    const onNotification = (notification) => {
      const isNew = !notificationIdsRef.current.has(notification._id);
      notificationIdsRef.current.add(notification._id);
      setNotifications((current) => [notification, ...current.filter((item) => item._id !== notification._id)].slice(0, 25));
      if (isNew) {
        setUnreadCount((current) => current + (notification.readAt ? 0 : 1));
        setTopAnnouncement(notification);
        toast.success(notification.title);
      }
    };
    const onPresence = (presence) => {
      setOnlineUsers((current) => {
        const withoutUser = current.filter((item) => item.userId !== presence.userId);
        return presence.status === "offline" ? withoutUser : [presence, ...withoutUser];
      });
    };
    let dashboardSyncTimer;
    const onDashboardSync = () => {
      window.clearTimeout(dashboardSyncTimer);
      dashboardSyncTimer = window.setTimeout(() => {
        setDashboardSyncTick((current) => current + 1);
      }, 300);
    };
    const onRealtimeError = (payload) => toast.error(payload.message || "Realtime event failed");

    activeSocket.on("connect", onConnect);
    activeSocket.on("disconnect", onDisconnect);
    activeSocket.on("connect_error", onConnectError);
    activeSocket.on(SOCKET_EVENTS.NOTIFICATION_NEW, onNotification);
    activeSocket.on(SOCKET_EVENTS.PRESENCE_UPDATE, onPresence);
    activeSocket.on(SOCKET_EVENTS.DASHBOARD_SYNC, onDashboardSync);
    activeSocket.on(SOCKET_EVENTS.APPOINTMENT_CREATED, onDashboardSync);
    activeSocket.on(SOCKET_EVENTS.APPOINTMENT_UPDATED, onDashboardSync);
    activeSocket.on(SOCKET_EVENTS.PAYMENT_CAPTURED, onDashboardSync);
    activeSocket.on(SOCKET_EVENTS.PAYMENT_REFUND, onDashboardSync);
    activeSocket.on(SOCKET_EVENTS.ERROR, onRealtimeError);

    const heartbeat = window.setInterval(() => {
      activeSocket.emit("presence:ping", {});
    }, 30000);

    return () => {
      window.clearInterval(heartbeat);
      window.clearTimeout(dashboardSyncTimer);
      activeSocket.off("connect", onConnect);
      activeSocket.off("disconnect", onDisconnect);
      activeSocket.off("connect_error", onConnectError);
      activeSocket.off(SOCKET_EVENTS.NOTIFICATION_NEW, onNotification);
      activeSocket.off(SOCKET_EVENTS.PRESENCE_UPDATE, onPresence);
      activeSocket.off(SOCKET_EVENTS.DASHBOARD_SYNC, onDashboardSync);
      activeSocket.off(SOCKET_EVENTS.APPOINTMENT_CREATED, onDashboardSync);
      activeSocket.off(SOCKET_EVENTS.APPOINTMENT_UPDATED, onDashboardSync);
      activeSocket.off(SOCKET_EVENTS.PAYMENT_CAPTURED, onDashboardSync);
      activeSocket.off(SOCKET_EVENTS.PAYMENT_REFUND, onDashboardSync);
      activeSocket.off(SOCKET_EVENTS.ERROR, onRealtimeError);
      disconnectSocket();
    };
  }, [isAuthenticated, loadNotifications, loadPresence, toast, token]);

  const markNotificationRead = useCallback(async (id) => {
    await realtimeApi.markNotificationRead(id);
    setNotifications((current) =>
      current.map((item) => (item._id === id ? { ...item, readAt: new Date().toISOString() } : item)),
    );
    setUnreadCount((current) => Math.max(current - 1, 0));
  }, []);

  const value = useMemo(
    () => ({
      socket,
      connectionStatus,
      notifications,
      unreadCount,
      onlineUsers,
      dashboardSyncTick,
      loadNotifications,
      markNotificationRead,
      topAnnouncement,
      setTopAnnouncement,
    }),
    [connectionStatus, dashboardSyncTick, loadNotifications, markNotificationRead, notifications, onlineUsers, socket, unreadCount, topAnnouncement],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtime must be used inside RealtimeProvider");
  return context;
};
