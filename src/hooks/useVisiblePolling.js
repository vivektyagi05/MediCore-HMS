import { useEffect, useRef } from "react";

const isHidden = () => typeof document !== "undefined" && document.hidden;

// Interval polling that is safe for admin dashboards.
//   useVisiblePolling(load, 15000, { isBusy: isInFlight });
// - Never overlaps: a tick is skipped while `isBusy()` says the previous request is still running.
// - Pauses while the browser tab is hidden (the interval is cleared, not just ignored).
// - On becoming visible again it refreshes once only if at least one full interval has passed since the last poll
//   attempt, then restarts the interval, so returning to the tab shows fresh data without a burst of catch-up requests.
// `task` and `isBusy` are read through refs, so callers can pass inline closures without restarting the timer.
export function useVisiblePolling(task, intervalMs, { enabled = true, isBusy } = {}) {
  const taskRef = useRef(task);
  const busyRef = useRef(isBusy);

  useEffect(() => {
    taskRef.current = task;
    busyRef.current = isBusy;
  });

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    let timer = null;
    let lastAttempt = Date.now();

    const attempt = () => {
      lastAttempt = Date.now();
      if (busyRef.current?.()) return;
      taskRef.current?.();
    };
    const tick = () => {
      if (isHidden()) return;
      attempt();
    };
    const start = () => {
      if (timer === null) timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (isHidden()) {
        stop();
        return;
      }
      stop();
      if (Date.now() - lastAttempt >= intervalMs) attempt();
      start();
    };

    if (!isHidden()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);
}
