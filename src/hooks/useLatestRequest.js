import { useCallback, useRef } from "react";

// Stale-response guard for list/filter loads.
//   const begin = useLatestRequest();
//   const load = async () => { const isCurrent = begin(); ...; const res = await api(); if (!isCurrent()) return; setData(res); }
// Without it, changing a filter twice quickly lets a slow EARLIER response arrive last and overwrite the newer list, and
// the first response to finish clears the loading flag while a newer request is still running.
export function useLatestRequest() {
  const seq = useRef(0);
  return useCallback(() => {
    seq.current += 1;
    const mine = seq.current;
    return () => mine === seq.current;
  }, []);
}
