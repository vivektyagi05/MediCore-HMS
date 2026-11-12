import { useCallback, useEffect, useMemo, useRef } from "react";

// Request lifecycle for admin list/dashboard loads: latest-request-wins plus an "is a request still running" signal.
//
//   const { begin, isInFlight } = useRequestLifecycle();
//   const load = async () => {
//     const request = begin();
//     setLoading(true);
//     try {
//       const res = await api();
//       if (!request.isCurrent()) return;      // a newer load started, or the component unmounted
//       setData(res.data);
//     } catch (e) {
//       if (!request.isCurrent()) return;
//       setError(msg(e));
//     } finally {
//       if (request.isCurrent()) setLoading(false);  // only the newest request clears the spinner
//       request.finish();
//     }
//   };
//
// Starting a load never cancels the HTTP call of an older one (the axios layer de-duplicates identical GETs); it only
// guarantees that the older response can no longer overwrite newer state. `isInFlight()` is for pollers: a timer tick
// should skip itself while ANY request is still pending (including an older one that a newer request outran) instead of
// stacking another one behind a slow response.
// Unmounting invalidates every outstanding request so nothing sets state on an unmounted page.
export function useRequestLifecycle() {
  const seq = useRef(0);
  // Every request that has begun and not yet settled. `isInFlight()` is true while ANY of them is outstanding, not just
  // the newest: if B (newer) settles before A (older), A's HTTP call is still running, so a poller must keep waiting.
  const outstanding = useRef(new Set());

  useEffect(
    () => () => {
      seq.current += 1; // invalidate every outstanding request: no state updates after unmount
      outstanding.current.clear();
    },
    [],
  );

  const begin = useCallback(() => {
    seq.current += 1;
    const mine = seq.current;
    const registry = outstanding.current;
    registry.add(mine);
    return {
      isCurrent: () => mine === seq.current,
      // Idempotent; safe to call from a `finally` block on success, error and stale paths alike.
      finish: () => {
        registry.delete(mine);
      },
    };
  }, []);

  const isInFlight = useCallback(() => outstanding.current.size > 0, []);

  return useMemo(() => ({ begin, isInFlight }), [begin, isInFlight]);
}
