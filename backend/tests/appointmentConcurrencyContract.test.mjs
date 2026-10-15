// CONCURRENCY CONTRACT SIMULATION — NOT a production/MongoDB verification.
//
// No MongoDB binary is available in this environment, so Appointment's query
// methods are replaced with an in-memory store that reproduces the ONE
// guarantee MongoDB gives us and these services rely on: a single-document
// findOneAndUpdate evaluates its filter and applies its update atomically.
// Everything else (interleaving of awaits, precondition filters, rollback,
// history, idempotency) is the real production code under test.
import assert from "node:assert/strict";
import Appointment from "../models/Appointment.js";
import HospitalSetting from "../models/HospitalSetting.js";
import { atomicTransition } from "../services/appointmentTransitionService.js";
import { verifyDailyCapacityAfterWrite } from "../services/appointmentBookingPolicyService.js";
import { clearHospitalSettingsCacheForTesting } from "../services/hospitalSettingsService.js";

let store = new Map();
const match = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
  const val = k.split(".").reduce((o, p) => (o == null ? o : o[p]), doc);
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    if ("$in" in cond) return cond.$in.some((c) => (c === null ? val == null : String(c) === String(val)));
    if ("$ne" in cond) return String(val) !== String(cond.$ne);
    if ("$exists" in cond) return (val !== undefined) === cond.$exists;
    if ("$lt" in cond) return val < cond.$lt;
    return true;
  }
  return String(val) === String(cond);
});
const setPath = (o, path, v) => { const ps = path.split("."); let c = o; ps.slice(0, -1).forEach((p) => { c[p] = c[p] ?? {}; c = c[p]; }); c[ps.at(-1)] = v; };
Appointment.findOneAndUpdate = async (filter, update) => {
  await Promise.resolve(); // yield: real requests interleave here
  const doc = [...store.values()].find((d) => match(d, filter)); // filter+update are ONE synchronous step below = atomic
  if (!doc) return null;
  for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, v);
  if (update.$push?.statusHistory) (doc.statusHistory ||= []).push(update.$push.statusHistory);
  return { ...doc, populate: async () => doc };
};
Appointment.exists = async (f) => (store.has(String(f._id)) ? { _id: f._id } : null);
Appointment.countDocuments = async (f) => { await Promise.resolve(); return [...store.values()].filter((d) => match(d, f)).length; };
Appointment.deleteOne = async (f) => { for (const [id, d] of store) if (match(d, f)) store.delete(id); };
const seed = (o = {}) => { const d = { _id: "a1", status: "payment_completed", paymentStatus: "paid", statusHistory: [], ...o }; store.set(String(d._id), d); return d; };
const code = (e) => e?.details?.code;

// 1) DOCTOR vs SCHEDULER — only one valid transition wins, in BOTH arrival orders
for (const order of ["doctorFirst", "schedulerFirst"]) {
  store = new Map(); const a = seed();
  const doctor = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_completed"], set: { status: "consultation_started" }, history: { status: "consultation_started", actorRole: "doctor" } });
  const scheduler = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_completed", "approved"], set: { status: "cancelled" }, history: { status: "cancelled", actorRole: "system" }, returnNullOnConflict: true });
  const results = await Promise.allSettled(order === "doctorFirst" ? [doctor(), scheduler()] : [scheduler(), doctor()]);
  const wins = results.filter((r) => r.status === "fulfilled" && r.value).length;
  assert.equal(wins, 1, `${order}: exactly one actor wins`);
  assert.equal(a.statusHistory.length, 1, `${order}: exactly one history entry`);
  const rejected = results.find((r) => r.status === "rejected");
  if (rejected) assert.equal(code(rejected.reason), "APPOINTMENT_STATE_CHANGED");
}
console.log("PASS [simulation]: doctor vs scheduler — one winner, one history entry, controlled conflict for the loser");

// 2) PAYMENT vs EXPIRY — a paid appointment can never be cancelled by a stale expiry
for (const order of ["payFirst", "expireFirst"]) {
  store = new Map(); const a = seed({ status: "payment_pending", paymentStatus: "pending" });
  const pay = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_pending"], set: { status: "payment_completed", paymentStatus: "paid" }, history: { status: "payment_completed" }, returnNullOnConflict: true });
  const expire = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_pending"], extraFilter: { paymentStatus: { $ne: "paid" } }, set: { status: "cancelled" }, history: { status: "cancelled", actorRole: "system" }, returnNullOnConflict: true });
  await Promise.all(order === "payFirst" ? [pay(), expire()] : [expire(), pay()]);
  assert.equal(a.statusHistory.length, 1, order);
  if (order === "payFirst") { assert.equal(a.status, "payment_completed"); assert.equal(a.paymentStatus, "paid"); }
  else { assert.equal(a.status, "cancelled"); } // expiry legitimately won first; payment then correctly lost (→ auto-refund branch in paymentController)
}
// the expiry's write-time precondition protects a payment that lands between its read and write
store = new Map(); const paid = seed({ status: "payment_pending", paymentStatus: "pending" });
const staleCandidate = { ...paid };           // expiry job read this while still pending
paid.status = "payment_completed"; paid.paymentStatus = "paid"; // payment lands before expiry writes
const stale = await atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_pending"], extraFilter: { paymentStatus: { $ne: "paid" } }, set: { status: "cancelled" }, history: { status: "cancelled" }, returnNullOnConflict: true });
assert.equal(stale, null); assert.equal(paid.status, "payment_completed"); assert.equal(staleCandidate.status, "payment_pending");
console.log("PASS [simulation]: payment vs expiry — stale expiry can never overwrite a successful payment");

// 3) DUPLICATE SCHEDULER EXECUTION — idempotent: one transition, one history entry
store = new Map(); const dup = seed({ status: "approved" });
const sweep = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["approved"], extraFilter: { "resolution.flaggedAt": { $exists: false } }, set: { "visit.state": "missed", "resolution.flaggedAt": new Date() }, history: { status: "approved", event: "missed", actorRole: "system" }, returnNullOnConflict: true });
const runs = await Promise.all([sweep(), sweep(), sweep()]);
assert.equal(runs.filter(Boolean).length, 1); assert.equal(dup.statusHistory.length, 1);
console.log("PASS [simulation]: duplicate/concurrent scheduler runs — one transition, one history entry");

// 4) DUPLICATE CHECK-IN / DUPLICATE CANCEL
store = new Map(); const ci = seed();
const checkin = () => atomicTransition({ appointmentId: "a1", fromStatuses: ["payment_completed"], fromVisitStates: ["not_arrived"], set: { "visit.state": "checked_in" }, history: { status: "payment_completed", event: "checked_in" }, returnNullOnConflict: true });
assert.equal((await Promise.all([checkin(), checkin()])).filter(Boolean).length, 1); assert.equal(ci.statusHistory.length, 1);
await assert.rejects(() => atomicTransition({ appointmentId: "missing", fromStatuses: ["x"], history: {} }), (e) => code(e) === "APPOINTMENT_NOT_FOUND");
console.log("PASS [simulation]: duplicate check-in — one winner; unknown id → APPOINTMENT_NOT_FOUND");

// 5) DAILY CAP — insert-then-verify: N concurrent inserts never leave more than the cap
const origFind = HospitalSetting.findOne;
HospitalSetting.findOne = () => ({ select: () => ({ lean: async () => ({ appointmentLimits: { dailyPerDoctor: 3, bookingWindowDays: 30 } }) }) });
clearHospitalSettingsCacheForTesting();
for (const racers of [2, 3, 5, 12]) {
  store = new Map();
  const date = new Date("2026-09-24T00:00:00Z");
  const attempt = async (i) => {
    const doc = { _id: `r${i}`, doctorId: "d1", date, status: "pending" };
    store.set(doc._id, doc); // durable write
    await verifyDailyCapacityAfterWrite({ doctorId: "d1", date, rollback: () => Appointment.deleteOne({ _id: doc._id }) });
    return doc._id;
  };
  const out = await Promise.allSettled(Array.from({ length: racers }, (_, i) => attempt(i)));
  const survivors = [...store.values()].length;
  assert.ok(survivors <= 3, `racers=${racers}: survivors ${survivors} must not exceed cap 3`);
  out.filter((r) => r.status === "rejected").forEach((r) => assert.equal(code(r.reason), "DAILY_CAPACITY_REACHED"));
  if (racers <= 3) assert.equal(survivors, racers, "under the cap nobody is rejected");
}
HospitalSetting.findOne = origFind;
console.log("PASS [simulation]: daily cap boundary — surviving bookings never exceed the cap under races (safety over liveness)");
