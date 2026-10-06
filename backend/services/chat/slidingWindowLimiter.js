// Per-key sliding-window limiter used by the chat engine so limits are keyed
// by USER (shared across every socket/tab/REST call), not by socket id — a
// per-socket counter is trivially bypassed by reconnecting (new socket id).
export function createSlidingWindowLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map(); // key -> number[] (timestamps)

  const prune = (stamps, cutoff) => {
    let i = 0;
    while (i < stamps.length && stamps[i] <= cutoff) i += 1;
    return i === 0 ? stamps : stamps.slice(i);
  };

  const sweep = setInterval(() => {
    const cutoff = now() - windowMs;
    for (const [key, stamps] of hits) {
      const kept = prune(stamps, cutoff);
      if (kept.length === 0) hits.delete(key);
      else if (kept !== stamps) hits.set(key, kept);
    }
  }, Math.max(windowMs, 30_000));
  sweep.unref?.();

  return {
    /** @returns {boolean} true if the call is allowed (and counted) */
    consume(key) {
      const t = now();
      const stamps = prune(hits.get(key) || [], t - windowMs);
      if (stamps.length >= max) {
        hits.set(key, stamps);
        return false;
      }
      stamps.push(t);
      hits.set(key, stamps);
      return true;
    },
    size: () => hits.size,
    stop: () => clearInterval(sweep),
  };
}
