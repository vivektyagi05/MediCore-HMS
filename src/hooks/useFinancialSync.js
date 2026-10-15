import { useEffect, useRef } from "react";
import { useRealtime } from "../context/RealtimeContext";

const FINANCE_EVENTS = ["finance:changed", "payment:captured", "payment:refund", "practice:subscription-updated", "practice:invoice-generated"];

/**
 * F-011 / F-024: keeps a financial screen consistent with the server.
 * Socket events are HINTS only (their payloads are never read into state): each
 * one, plus socket reconnect, browser tab resume and network recovery, triggers a
 * debounced refetch of the authoritative REST state. If the refetch itself fails
 * it is retried with backoff so a screen never stays stale silently.
 */
export function useFinancialSync(refetch, { domains } = {}) {
  const { socket, connectionStatus } = useRealtime();
  const refetchRef = useRef(refetch);
  const wasOfflineRef = useRef(false);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    let timer;
    let retryTimer;
    const run = async (attempt = 0) => {
      try {
        await refetchRef.current?.();
      } catch {
        if (attempt < 3) retryTimer = window.setTimeout(() => run(attempt + 1), 1000 * 2 ** attempt);
      }
    };
    const schedule = (payload) => {
      if (domains && payload?.domain && !domains.includes(payload.domain)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => run(), 250);
    };
    const onVisible = () => { if (document.visibilityState === "visible") schedule(); };
    const onOnline = () => schedule();
    FINANCE_EVENTS.forEach((e) => socket?.on(e, schedule));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      FINANCE_EVENTS.forEach((e) => socket?.off(e, schedule));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [socket, domains]);

  useEffect(() => {
    if (connectionStatus === "offline" || connectionStatus === "error") wasOfflineRef.current = true;
    if (connectionStatus === "online" && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      refetchRef.current?.();
    }
  }, [connectionStatus]);

  return { connectionStatus, isLive: connectionStatus === "online" };
}
