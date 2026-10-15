// N-001: safe, repeatable index ensure/verify logic.
//
// Operates on a native MongoDB `Db` handle so it is unit-testable with a fake
// and usable from the migration, the readiness check and the verify script.
//
// Safety rules (each one is tested):
//  * Never deletes or edits a document and never DROPS an index.
//  * Unique indexes are preceded by a duplicate scan; duplicates BLOCK that
//    index (reported with the conflicting ids) instead of failing mid-build.
//  * An existing index is compared on key + behavioural options, not on name.
//  * Incompatible existing indexes are reported as CONFLICTS, never replaced.
//  * Every creation is verified by re-reading listIndexes.
import { normalizeOptions, stableStringify } from "./indexInventory.js";

export const STATUS = Object.freeze({
  PRESENT: "present",
  CREATED: "created",
  WOULD_CREATE: "would_create",
  BLOCKED_DUPLICATES: "blocked_duplicates",
  CONFLICT: "conflict",
  FAILED: "failed",
  UNVERIFIED: "unverified",
});

const isNamespaceMissing = (error) => error?.code === 26 || /ns does not exist|NamespaceNotFound/i.test(String(error?.message));

async function listIndexesSafe(db, collection) {
  try {
    return await db.collection(collection).indexes();
  } catch (error) {
    if (isNamespaceMissing(error)) return [];
    throw error;
  }
}

const keyOf = (index) => stableStringify(index.key || {});

/** Compare a declared spec against what the server has. */
export function classifyAgainst(spec, existing) {
  const wanted = stableStringify(spec.options);
  const sameName = existing.find((i) => i.name === spec.name);
  if (sameName) {
    const have = stableStringify(normalizeOptions(sameName, { isText: spec.text }));
    if (spec.text || (keyOf(sameName) === stableStringify(spec.key) && have === wanted)) return { state: "present", index: sameName };
    return {
      state: "conflict",
      index: sameName,
      reason: `index named ${spec.name} exists with different definition (have key=${keyOf(sameName)} options=${have}; want key=${stableStringify(spec.key)} options=${wanted})`,
    };
  }
  if (!spec.text) {
    const sameKey = existing.filter((i) => keyOf(i) === stableStringify(spec.key));
    const equivalent = sameKey.find((i) => stableStringify(normalizeOptions(i)) === wanted);
    if (equivalent) return { state: "present", index: equivalent, note: `satisfied by equivalent index ${equivalent.name}` };
    if (sameKey.length) return { state: "missing", legacy: sameKey.map((i) => i.name), note: `same key already indexed as ${sameKey.map((i) => i.name).join(", ")} with different options; creating additively` };
  }
  return { state: "missing" };
}

/** Duplicate scan for a unique spec. Returns { groups, samples }. */
export async function findDuplicates(db, spec, { sampleLimit = 20 } = {}) {
  const keyFields = Object.keys(spec.key);
  const pipeline = [];
  if (spec.options.partialFilterExpression) pipeline.push({ $match: spec.options.partialFilterExpression });
  else if (spec.options.sparse) pipeline.push({ $match: { $or: keyFields.map((f) => ({ [f]: { $exists: true } })) } });
  const _id = Object.fromEntries(keyFields.map((f) => [f, `$${f}`]));
  pipeline.push(
    { $group: { _id, count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: sampleLimit },
  );
  const rows = await db.collection(spec.collection).aggregate(pipeline, { allowDiskUse: true }).toArray();
  return {
    groups: rows.length,
    samples: rows.map((r) => ({ key: r._id, count: r.count, ids: r.ids.slice(0, 10).map(String) })),
  };
}

/**
 * Existing sparse+unique indexes that the inventory supersedes with a
 * partial one: report how many explicit-null rows they would trip on.
 */
export async function scanLegacySparse(db, specs) {
  const out = [];
  const byCollection = new Map();
  for (const s of specs) (byCollection.get(s.collection) || byCollection.set(s.collection, []).get(s.collection)).push(s);
  for (const [collection, list] of byCollection) {
    const existing = await listIndexesSafe(db, collection);
    for (const idx of existing) {
      if (!(idx.unique && idx.sparse && !idx.partialFilterExpression)) continue;
      const replacement = list.find((s) => s.unique && s.options.partialFilterExpression && keyOf(idx) === stableStringify(s.key));
      if (!replacement) continue;
      const fields = Object.keys(idx.key);
      // Explicit null (not merely missing) is what a sparse unique index trips on.
      const nullRows = await db.collection(collection).countDocuments({ $or: fields.map((f) => ({ [f]: { $type: "null" } })) }).catch(() => null);
      out.push({
        collection,
        legacyIndex: idx.name,
        replacedBy: replacement.name,
        explicitNullRows: nullRows,
        manualStep: `After confirming ${replacement.name} is present and traffic is healthy: db.getCollection("${collection}").dropIndex("${idx.name}")`,
      });
    }
  }
  return out;
}

/**
 * Ensure (or, with dryRun, plan) every spec.
 * @returns {{ok:boolean, exitCode:number, summary:object, results:Array, legacy:Array}}
 */
export async function ensureIndexes(db, specs, { dryRun = false, log = () => {} } = {}) {
  const results = [];
  const byCollection = new Map();
  for (const s of specs) (byCollection.get(s.collection) || byCollection.set(s.collection, []).get(s.collection)).push(s);

  for (const [collection, list] of byCollection) {
    let existing = await listIndexesSafe(db, collection);
    for (const spec of list) {
      const base = { collection, name: spec.name, key: spec.key, unique: spec.unique, invariant: spec.invariant };
      const verdict = classifyAgainst(spec, existing);

      if (verdict.state === "present") { results.push({ ...base, status: STATUS.PRESENT, note: verdict.note }); continue; }
      if (verdict.state === "conflict") { results.push({ ...base, status: STATUS.CONFLICT, reason: verdict.reason }); continue; }

      if (spec.unique) {
        const dup = await findDuplicates(db, spec);
        if (dup.groups > 0) {
          results.push({ ...base, status: STATUS.BLOCKED_DUPLICATES, duplicateGroups: dup.groups, samples: dup.samples });
          continue;
        }
      }
      if (dryRun) { results.push({ ...base, status: STATUS.WOULD_CREATE, note: verdict.note }); continue; }

      try {
        await db.collection(collection).createIndex(spec.key, { ...spec.options, name: spec.name });
      } catch (error) {
        results.push({ ...base, status: STATUS.FAILED, error: `${error?.codeName || error?.code || "error"}: ${error?.message}` });
        continue;
      }
      existing = await listIndexesSafe(db, collection); // verify by re-reading, never by trusting createIndex's return
      const verified = classifyAgainst(spec, existing).state === "present";
      results.push({ ...base, status: verified ? STATUS.CREATED : STATUS.UNVERIFIED, note: verified ? verdict.note : "createIndex returned but listIndexes does not show the index" });
      log(`${verified ? "created" : "UNVERIFIED"} ${collection}.${spec.name}`);
    }
  }

  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = Object.fromEntries(Object.values(STATUS).map((s) => [s, count(s)]));
  summary.total = results.length;
  const blocking = results.filter((r) => [STATUS.BLOCKED_DUPLICATES, STATUS.CONFLICT, STATUS.FAILED, STATUS.UNVERIFIED].includes(r.status));
  const pendingInDryRun = dryRun ? count(STATUS.WOULD_CREATE) : 0;
  const legacy = await scanLegacySparse(db, specs).catch(() => []);
  const ok = blocking.length === 0;
  return { ok, exitCode: ok ? (pendingInDryRun ? 3 : 0) : 2, summary, results, legacy, dryRun };
}

/** Fast read-only check used by readiness probes: are the correctness-bearing indexes present? */
export async function checkCriticalIndexes(db, criticalSpecList) {
  const missing = [];
  const byCollection = new Map();
  for (const s of criticalSpecList) (byCollection.get(s.collection) || byCollection.set(s.collection, []).get(s.collection)).push(s);
  for (const [collection, list] of byCollection) {
    const existing = await listIndexesSafe(db, collection);
    for (const spec of list) {
      if (classifyAgainst(spec, existing).state !== "present") missing.push(`${collection}.${spec.name}`);
    }
  }
  return { ready: missing.length === 0, missing, checked: criticalSpecList.length };
}
