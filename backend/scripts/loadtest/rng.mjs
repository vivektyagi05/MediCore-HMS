import { createHash } from "node:crypto";

// Deterministic PRNG (mulberry32) keyed by (seed, key) so any record can be
// regenerated independently and identically — no shared mutable stream.
const seedInt = (str) => createHash("sha1").update(str).digest().readUInt32BE(0);

export const makeRng = (seed, key) => {
  let a = seedInt(`${seed}|${key}`) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // weights: [[value, weight], ...]
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
  };
};
