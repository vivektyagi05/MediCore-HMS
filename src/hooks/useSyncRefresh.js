import { useEffect, useRef } from "react";

const isHidden = () => typeof document !== "undefined" && document.hidden;

// Re-runs `load` when the realtime `dashboardSyncTick` changes, but not on mount (callers do their own first load) and not
// while the tab is hidden: a tick that arrives in a background tab is remembered and applied once, when the tab is visible
// again. Without this every open admin tab, widget shell included, refetches on every realtime event nobody can see.
export function useSyncRefresh(load, syncTick) {
  const loadRef = useRef(load);
  const lastTick = useRef(syncTick);
  const pending = useRef(false);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (lastTick.current === syncTick) return;
    lastTick.current = syncTick;
    if (isHidden()) {
      pending.current = true;
      return;
    }
    loadRef.current?.();
  }, [syncTick]);

  useEffect(() => {
    const onVisibility = () => {
      if (isHidden() || !pending.current) return;
      pending.current = false;
      loadRef.current?.();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
