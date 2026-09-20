// Import the Government of India Local Government Directory (LGD) geography
// (State → District → City/urban local body) into the canonical MasterData
// collection, plus the repository-controlled specialization vocabulary.
//
//   npm run migrate:master-data:lgd
//
// Idempotent: records are upserted on (kind, parentId, normalizedName), so
// re-runs never duplicate and existing MongoDB _ids are preserved (doctors
// reference them). Fails loudly — never leaves the caller with a silently
// empty or partial geography.
import { connectDB, disconnectDB } from "../config/db.js";
import MasterData from "../models/MasterData.js";
import { CANONICAL_MASTER_SEEDS } from "../master-data/canonicalSeed.js";
import { loadLgdSource, cleanName, normalizeName } from "../master-data/lgdSource.js";

const CHUNK = 1000;
const keyOf = (parentId, normalizedName) => `${parentId ? String(parentId) : ""}|${normalizedName}`;

// Read-diff-write instead of one upsert per record: a fresh import is a handful
// of insertMany calls, a re-run performs no writes at all (idempotent), and the
// unique (kind, parentId, normalizedName) index remains the concurrency guard.
// Existing _ids are always preserved (doctors reference them).
const syncRecords = async (kind, records) => {
  const existing = await MasterData.find({ kind }).select("_id name parentId normalizedName active source").lean();
  const byKey = new Map(existing.map((doc) => [keyOf(doc.parentId, doc.normalizedName), doc]));

  const toInsert = [];
  const toUpdate = [];
  const seen = new Set();
  for (const { name, parentId, source } of records) {
    const normalizedNameValue = normalizeName(name);
    const key = keyOf(parentId, normalizedNameValue);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = byKey.get(key);
    if (!current) {
      toInsert.push({ kind, name: cleanName(name), normalizedName: normalizedNameValue, parentId: parentId || null, active: true, source });
    } else if (!current.active || (current.source !== source && current.source !== "lgd")) {
      toUpdate.push({ _id: current._id, source: current.source === "lgd" ? "lgd" : source });
    }
  }

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    try {
      const chunk = toInsert.slice(i, i + CHUNK);
      const inserted = await MasterData.insertMany(chunk, { ordered: false });
      // insertMany({ordered:false}) can swallow per-document validation errors and
      // simply return fewer documents; never accept a silent shortfall.
      if (inserted.length !== chunk.length) {
        throw new Error(`LGD import: ${kind} insert shortfall (${inserted.length}/${chunk.length}) — a document failed validation`);
      }
    } catch (error) {
      const writeErrors = error?.writeErrors || error?.results?.filter?.((r) => r instanceof Error) || [];
      const onlyDuplicates = error?.code === 11000 || (writeErrors.length > 0 && writeErrors.every((e) => (e.code ?? e.err?.code) === 11000));
      if (!onlyDuplicates) throw error; // a concurrent run inserted the same rows: safe to ignore
    }
  }
  if (toUpdate.length) {
    await MasterData.bulkWrite(
      toUpdate.map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: { active: true, source: u.source } } } })),
      { ordered: false },
    );
  }

  const after = await MasterData.find({ kind }).select("_id parentId normalizedName").lean();
  return { idByKey: new Map(after.map((doc) => [keyOf(doc.parentId, doc.normalizedName), doc._id])), inserted: toInsert.length, updated: toUpdate.length };
};

export const importLgdMasterData = async ({ env = process.env } = {}) => {
  // 1. Verified source first: throws before any DB write if it is missing/altered.
  const source = loadLgdSource({ env });

  // The unique (kind, parentId, normalizedName) index is the idempotency/concurrency
  // guard. Production runs with autoIndex disabled, so build it explicitly.
  await MasterData.createIndexes();

  // 2. Controlled clinical vocabulary (deterministic, idempotent).
  const specs = await syncRecords("specialization", CANONICAL_MASTER_SEEDS.map((item) => ({ name: item.name, parentId: null, source: "seed" })));

  // 3. States.
  const stateSync = await syncRecords("state", source.states.map((s) => ({ name: s.name, parentId: null, source: "lgd" })));
  const stateIdByKey = new Map(source.states.map((s) => [s.key, stateSync.idByKey.get(keyOf(null, normalizeName(s.name)))]));
  const missingState = source.states.find((s) => !stateIdByKey.get(s.key));
  if (missingState) throw new Error(`LGD import: state not persisted: ${missingState.name}`);

  // 4. Districts (parent = state).
  const districtSync = await syncRecords("district", source.districts.map((d) => ({ name: d.name, parentId: stateIdByKey.get(d.stateKey), source: "lgd" })));
  const districtIdByKey = new Map(
    source.districts.map((d) => [d.key, districtSync.idByKey.get(keyOf(stateIdByKey.get(d.stateKey), normalizeName(d.name)))]),
  );
  const missingDistrict = source.districts.find((d) => !districtIdByKey.get(d.key));
  if (missingDistrict) throw new Error(`LGD import: district not persisted: ${missingDistrict.name}`);

  // 5. Cities (parent = district). Matching is always scoped by district.
  const citySync = await syncRecords("city", source.cities.map((c) => ({ name: c.name, parentId: districtIdByKey.get(c.districtKey), source: "lgd" })));

  // 6. Verify the database really contains the source hierarchy.
  const counts = {
    specializations: await MasterData.countDocuments({ kind: "specialization", active: true }),
    states: await MasterData.countDocuments({ kind: "state", active: true }),
    districts: await MasterData.countDocuments({ kind: "district", active: true }),
    cities: await MasterData.countDocuments({ kind: "city", active: true }),
  };
  const lgdCounts = {
    states: await MasterData.countDocuments({ kind: "state", source: "lgd", active: true }),
    districts: await MasterData.countDocuments({ kind: "district", source: "lgd", active: true }),
    cities: await MasterData.countDocuments({ kind: "city", source: "lgd", active: true }),
  };
  if (lgdCounts.states < source.stats.states || lgdCounts.districts < source.stats.districts || lgdCounts.cities < source.stats.cities) {
    throw new Error(`LGD import incomplete: source=${JSON.stringify(source.stats)} database(lgd)=${JSON.stringify(lgdCounts)}`);
  }

  return {
    counts,
    lgdCounts,
    written: { specializations: specs.inserted, states: stateSync.inserted, districts: districtSync.inserted, cities: citySync.inserted },
    source: source.stats,
    snapshotDate: source.manifest?.snapshotDate || null,
  };
};

const run = async () => {
  await connectDB();
  const result = await importLgdMasterData();
  console.log(JSON.stringify({ source: "Government of India Local Government Directory (LGD)", ...result }));
};

if (process.argv[1]?.endsWith("005_import_lgd_master_data.js")) {
  run().catch((error) => { console.error(error.message || error); process.exitCode = 1; }).finally(() => disconnectDB());
}
