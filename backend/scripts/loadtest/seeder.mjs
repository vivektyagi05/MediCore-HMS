import bcrypt from "bcrypt";
import {
  buildAdminUser, buildDoctorUser, buildPatientUser, buildDoctorProfile, buildCalendar, buildAppointmentBundle,
  buildSavedDoctors, buildAdminLog, buildCronLog, buildAutomationLog, SPECIALIZATIONS,
} from "./generate.mjs";
import { idRange, KIND } from "./ids.mjs";

const newStat = () => ({ inserted: 0, updated: 0, skipped: 0, retried: 0 });
const KIND_OF = { users: KIND.user, doctors: KIND.doctor, appointments: KIND.appointment, payments: KIND.payment, invoices: KIND.invoice, payouts: KIND.payout, ledger: KIND.ledger, refunds: KIND.refund, notes: KIND.note, prescriptions: KIND.prescription, reviews: KIND.review, notifications: KIND.notification, reminders: KIND.reminder, chats: KIND.chat, saved: KIND.saved, adminLogs: KIND.adminlog, cronLogs: KIND.cron, automationLogs: KIND.automation };
export const kindOfCollection = (key) => KIND_OF[key];

const readCounts = (r) => ({
  upserted: r?.upsertedCount ?? r?.nUpserted ?? 0,
  modified: r?.modifiedCount ?? r?.nModified ?? 0,
  matched: r?.matchedCount ?? r?.nMatched ?? 0,
});

// Deterministic id-keyed upserts. The filter is ALWAYS { _id } for a namespace-owned id, so a
// rerun repairs this namespace and can never touch an unrelated document.
export const upsertBatch = async (Model, docs, stat, label) => {
  let pending = docs.map((d) => { const { _id, ...rest } = d; return { updateOne: { filter: { _id }, update: { $set: rest }, upsert: true } }; });
  for (let attempt = 0; pending.length && attempt < 4; attempt += 1) {
    let res; let failedIdx = [];
    try {
      res = await Model.bulkWrite(pending, { ordered: false, timestamps: false });
    } catch (err) {
      if (!err?.writeErrors && !err?.result) throw err;
      res = err.result;
      const errs = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors].filter(Boolean);
      const nonDup = errs.filter((e) => (e.code ?? e.err?.code) !== 11000);
      if (nonDup.length) throw new Error(`${label}: bulk write failed (${nonDup[0].errmsg || nonDup[0].err?.errmsg || "write error"})`);
      failedIdx = errs.map((e) => e.index ?? e.err?.index);
    }
    const c = readCounts(res);
    stat.inserted += c.upserted; stat.updated += c.modified; stat.skipped += Math.max(c.matched - c.modified, 0);
    pending = failedIdx.map((i) => pending[i]);
    if (pending.length) stat.retried += pending.length; // e.g. a re-anchored slot freed by an earlier op in the same batch
  }
  if (pending.length) {
    throw new Error(`${label}: ${pending.length} documents still conflict with a unique index after retries (a foreign document may own the key). Aborting without deleting anything.`);
  }
};

const chunk = (n, size, fn) => { const out = []; for (let s = 0; s < n; s += size) out.push([s, Math.min(s + size, n)]); return out.map(([a, b]) => fn(a, b)); };

export const resolvePasswordHash = async (User, plan, password) => {
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12); // same contract as models/User.js (env.bcryptSaltRounds)
  const existing = await User.findById(buildAdminUser(plan, 0, { passwordHash: "x" })._id).select("+password").lean();
  if (existing?.password && (await bcrypt.compare(password, existing.password))) return { hash: existing.password, reused: true };
  return { hash: await bcrypt.hash(password, rounds), reused: false };
};

export const resolveSpecializationIds = async (MasterData) => {
  const rows = await MasterData.find({ kind: "specialization", active: true, name: { $in: SPECIALIZATIONS } }).select("name").lean();
  return new Map(rows.map((r) => [r.name, r._id]));
};

export const countOwned = async (Model, ns, key) => {
  const { lo, hi } = idRange(ns, kindOfCollection(key));
  return Model.countDocuments({ _id: { $gte: lo, $lte: hi } });
};

export const runSeed = async ({ plan, models, passwordHash, ratings, specializationMasterIds, log = () => {} }) => {
  const stats = Object.fromEntries(Object.keys(kindOfCollectionMap()).map((k) => [k, newStat()]));
  const ctx = { passwordHash, ratings, specializationMasterIds };
  const bs = plan.batchSize;
  const t0 = Date.now();

  // 1) Users → 2) Doctor profiles (dependency order)
  for (const [a, b] of chunk(plan.admins, bs, (x, y) => [x, y])) await upsertBatch(models.users, Array.from({ length: b - a }, (_, k) => buildAdminUser(plan, a + k, ctx)), stats.users, "users(admin)");
  for (const [a, b] of chunk(plan.doctors, bs, (x, y) => [x, y])) await upsertBatch(models.users, Array.from({ length: b - a }, (_, k) => buildDoctorUser(plan, a + k, ctx)), stats.users, "users(doctor)");
  for (const [a, b] of chunk(plan.patients, bs, (x, y) => [x, y])) await upsertBatch(models.users, Array.from({ length: b - a }, (_, k) => buildPatientUser(plan, a + k, ctx)), stats.users, "users(patient)");
  log(`users done (${Date.now() - t0}ms)`);
  for (const [a, b] of chunk(plan.doctors, bs, (x, y) => [x, y])) await upsertBatch(models.doctors, Array.from({ length: b - a }, (_, k) => buildDoctorProfile(plan, a + k, ctx)), stats.doctors, "doctors");
  log(`doctor profiles done (${Date.now() - t0}ms)`);

  // 3) Appointments and everything that hangs off them, one bounded batch at a time.
  const cal = buildCalendar(plan);
  const COLS = ["payments", "invoices", "payouts", "ledger", "refunds", "notes", "prescriptions", "reviews", "notifications", "reminders", "chats"];
  for (const [a, b] of chunk(plan.appointments, bs, (x, y) => [x, y])) {
    const acc = { appointments: [] }; COLS.forEach((c) => { acc[c] = []; });
    for (let i = a; i < b; i += 1) {
      const bundle = buildAppointmentBundle(plan, cal, i);
      acc.appointments.push(...bundle.appointments);
      COLS.forEach((c) => acc[c].push(...bundle[c]));
    }
    await upsertBatch(models.appointments, acc.appointments, stats.appointments, "appointments");
    for (let s = 0; s < COLS.length; s += 4) {
      await Promise.all(COLS.slice(s, s + 4).filter((c) => acc[c].length).map((c) => upsertBatch(models[c], acc[c], stats[c], c)));
    }
    if (((b / bs) | 0) % 10 === 0 || b === plan.appointments) log(`appointments ${b}/${plan.appointments} (${Date.now() - t0}ms)`);
  }

  // 4) Saved doctors + operational logs
  for (const [a, b] of chunk(plan.patients, bs, (x, y) => [x, y])) {
    const docs = []; for (let i = a; i < b; i += 1) docs.push(...buildSavedDoctors(plan, i));
    if (docs.length) await upsertBatch(models.saved, docs, stats.saved, "saved");
  }
  for (const [a, b] of chunk(plan.adminLogs, bs, (x, y) => [x, y])) await upsertBatch(models.adminLogs, Array.from({ length: b - a }, (_, k) => buildAdminLog(plan, a + k)), stats.adminLogs, "adminLogs");
  for (const [a, b] of chunk(plan.cronLogs, bs, (x, y) => [x, y])) await upsertBatch(models.cronLogs, Array.from({ length: b - a }, (_, k) => buildCronLog(plan, a + k)), stats.cronLogs, "cronLogs");
  for (const [a, b] of chunk(plan.automationLogs, bs, (x, y) => [x, y])) await upsertBatch(models.automationLogs, Array.from({ length: b - a }, (_, k) => buildAutomationLog(plan, a + k)), stats.automationLogs, "automationLogs");
  return { stats, durationMs: Date.now() - t0 };
};

function kindOfCollectionMap() { return KIND_OF; }
