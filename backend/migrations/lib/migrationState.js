// N-001: durable migration bookkeeping + a serialized lock.
//
// Two replicas (or an operator and a deploy hook) must never run the same
// migration at once, and a run that died half-way must NOT look "completed".
// State lives in the `migration_state` collection: one document per migration
// id with status running|completed|blocked|failed, an ownerToken and a lease.
// All transitions are conditioned on the ownerToken (fencing), and a lease
// that expired (crashed runner) can be taken over.
import os from "os";
import { randomUUID } from "crypto";

export const MIGRATION_STATE_COLLECTION = "migration_state";
export const DEFAULT_MIGRATION_LEASE_MS = 15 * 60 * 1000;

const isDup = (e) => e?.code === 11000;

/** @returns {Promise<{token:string}|null>} null when another live runner holds it */
export async function acquireMigrationLock(db, id, { leaseMs = DEFAULT_MIGRATION_LEASE_MS, now = () => new Date() } = {}) {
  const coll = db.collection(MIGRATION_STATE_COLLECTION);
  const token = randomUUID();
  const startedAt = now();
  const running = { status: "running", ownerToken: token, startedAt, finishedAt: null, leaseExpiresAt: new Date(startedAt.getTime() + leaseMs), host: os.hostname(), pid: process.pid, summary: null };
  try {
    await coll.insertOne({ _id: id, ...running });
    return { token };
  } catch (error) {
    if (!isDup(error)) throw error;
  }
  const current = await coll.findOne({ _id: id });
  if (!current) return acquireMigrationLock(db, id, { leaseMs, now }); // deleted between calls
  const live = current.status === "running" && current.leaseExpiresAt && new Date(current.leaseExpiresAt).getTime() > now().getTime();
  if (live) return null;
  const taken = await coll.updateOne({ _id: id, ownerToken: current.ownerToken, status: current.status }, { $set: running });
  return taken.matchedCount === 1 ? { token } : null;
}

/** Fenced: only the current owner of a still-running record can finish it. */
export async function finishMigration(db, id, token, { status, summary = null }) {
  const result = await db.collection(MIGRATION_STATE_COLLECTION).updateOne(
    { _id: id, ownerToken: token, status: "running" },
    { $set: { status, finishedAt: new Date(), summary } },
  );
  return result.matchedCount === 1;
}

export async function getMigrationState(db, id) {
  return db.collection(MIGRATION_STATE_COLLECTION).findOne({ _id: id });
}
