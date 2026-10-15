// N-023: deployment readiness. Liveness (/api/health) says the process is up;
// readiness says it is safe to take traffic: Mongo answers a ping AND the
// correctness-bearing indexes from migration 011 exist (autoIndex is off in
// production, so a deploy that skipped migrations would otherwise look healthy
// while idempotency/lock guarantees silently did not exist).
import mongoose from "mongoose";
import { buildInventory, criticalSpecs, loadAllModels } from "../migrations/lib/indexInventory.js";
import { checkCriticalIndexes } from "../migrations/lib/indexMigration.js";
import { verifyLockIndex } from "../utils/cronRunTracker.js";

const CACHE_MS = 30_000;
let cache = null;

export const resetReadinessCache = () => { cache = null; };

export async function getReadiness({ now = Date.now(), db = null } = {}) {
  if (cache && now - cache.at < CACHE_MS) return cache.value;

  const checks = { database: { ok: false }, indexes: { ok: false }, schedulerLock: { ok: false } };
  const handle = db || mongoose.connection?.db;
  try {
    if (!db && mongoose.connection.readyState !== 1) throw new Error("not connected");
    await handle.admin().ping();
    checks.database = { ok: true };
  } catch (error) {
    checks.database = { ok: false, error: String(error?.message).slice(0, 120) };
  }

  if (checks.database.ok) {
    try {
      await loadAllModels();
      const result = await checkCriticalIndexes(handle, criticalSpecs(buildInventory()));
      checks.indexes = { ok: result.ready, checked: result.checked, missing: result.missing.slice(0, 20) };
    } catch (error) {
      checks.indexes = { ok: false, error: String(error?.message).slice(0, 120) };
    }
    checks.schedulerLock = { ok: await verifyLockIndex({ force: true }).catch(() => false) };
  }

  const value = { ready: Object.values(checks).every((c) => c.ok), checks };
  cache = { at: now, value };
  return value;
}
