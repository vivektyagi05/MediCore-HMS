import { useEffect, useRef } from "react";
import { useRealtime } from "../context/RealtimeContext";
import { SOCKET_EVENTS } from "../socket/socketEvents";

const EVENTS = [
  SOCKET_EVENTS.APPOINTMENT_CREATED,
  SOCKET_EVENTS.APPOINTMENT_UPDATED,
  SOCKET_EVENTS.APPOINTMENT_RESCHEDULED,
  SOCKET_EVENTS.APPOINTMENT_CHECKED_IN,
  SOCKET_EVENTS.APPOINTMENT_CALLED,
  SOCKET_EVENTS.APPOINTMENT_DELAY,
  SOCKET_EVENTS.APPOINTMENT_MISSED,
  SOCKET_EVENTS.APPOINTMENT_EXPIRED,
  SOCKET_EVENTS.APPOINTMENT_RESOLUTION_REQUIRED,
  SOCKET_EVENTS.APPOINTMENT_QUEUE_UPDATED,
];

/**
 * Keeps a screen consistent with the server.
 *
 * Socket events are only a HINT: every event (and every reconnect after a
 * drop, when events may have been missed) triggers a debounced refetch of the
 * authoritative REST state. Payloads are never merged into UI state.
 * Returns the connection status so screens can show an honest banner.
 */
export function useAppointmentSync(refetch, { filterId } = {}) {
  const { socket, connectionStatus } = useRealtime();
  const refetchRef = useRef(refetch);
  const wasOfflineRef = useRef(false);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!socket) return undefined;
    let timer;
    const schedule = (payload) => {
      if (filterId && payload?.appointmentId && String(payload.appointmentId) !== String(filterId)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => refetchRef.current?.(), 250);
    };
    EVENTS.forEach((e) => socket.on(e, schedule));
    return () => {
      window.clearTimeout(timer);
      EVENTS.forEach((e) => socket.off(e, schedule));
    };
  }, [socket, filterId]);

  // Missed-event recovery: whenever we come back ONLINE after being offline/errored, re-read.
  useEffect(() => {
    if (connectionStatus === "offline" || connectionStatus === "error") wasOfflineRef.current = true;
    if (connectionStatus === "online" && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      refetchRef.current?.();
    }
  }, [connectionStatus]);

  return { connectionStatus, isLive: connectionStatus === "online" };
}
