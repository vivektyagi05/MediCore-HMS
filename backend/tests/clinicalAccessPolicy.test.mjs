// Clinical access policy — negative-first regression suite.
// Replaces the old chatAuthorization.test.mjs, which asserted the weak
// "any appointment exists" rule this phase removed.
import assert from "node:assert/strict";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  CLINICAL_RECORD_STATUSES,
  assertDoctorPatientRecordAccess,
  buildSharedFamilyFilter,
  buildSharedInsuranceFilter,
  buildSharedRecordScope,
  buildSharedReportFilter,
  chatEligibleFromAppointments,
  filterRecordAppointments,
  usersCanChat,
  usersCanReadConversationHistory,
} from "../services/clinicalAccessService.js";

let failures = 0;
const run = async (name, fn) => {
  try { await fn(); console.log(`  PASS ${name}`); } catch (error) { failures += 1; console.error(`  FAIL ${name}`); console.error(error); }
};
console.log("clinicalAccessPolicy.test.mjs");

// Minimal evaluator for the Mongo operators our filters use, so the SCENARIO
// tests exercise the real filter objects rather than re-describing them.
const idStr = (v) => (v === undefined || v === null ? v : String(v));
const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
  if (key === "$and") return cond.every((f) => matches(doc, f));
  if (key === "$or") return cond.some((f) => matches(doc, f));
  const value = doc[key];
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    if ("$in" in cond) return cond.$in.map(idStr).includes(idStr(value));
    if ("$exists" in cond) return cond.$exists ? value !== undefined : value === undefined;
    if ("$ne" in cond) return idStr(value) !== idStr(cond.$ne);
  }
  return idStr(value) === idStr(cond);
});

const D = "doc-1", D2 = "doc-2", P = "pat-1", F = "fam-1", F2 = "fam-2";
const day = 24 * 60 * 60 * 1000;
const appt = (o) => ({ _id: `a-${Math.random()}`, status: "payment_completed", date: new Date(), ...o });

// ── record-eligible statuses ─────────────────────────────────────────────
await run("only paid consultation-stage statuses qualify for record access", () => {
  const all = ["pending", "approved", "payment_pending", "cancelled", "rejected", "no_show", "payment_completed", "consultation_started", "consultation_completed", "completed", "review_eligible"];
  const eligible = filterRecordAppointments(all.map((status) => ({ status }))).map((a) => a.status);
  assert.deepEqual(eligible.sort(), [...CLINICAL_RECORD_STATUSES].sort());
  for (const bad of ["pending", "approved", "payment_pending", "cancelled", "rejected", "no_show"]) assert.ok(!eligible.includes(bad), bad);
});

// ── the report-sharing matrix (the P0) ───────────────────────────────────
const reports = {
  untaggedPrivate: { _id: "r1", userId: P },
  taggedToDoctor: { _id: "r2", userId: P, doctorId: D },
  linkedToPaidAppt: { _id: "r3", userId: P, appointmentId: "A-paid" },
  attachedAtBooking: { _id: "r4", userId: P },
  taggedToOtherDoctor: { _id: "r5", userId: P, doctorId: D2 },
  otherPatient: { _id: "r6", userId: "pat-2", doctorId: D },
  linkedToCancelled: { _id: "r7", userId: P, appointmentId: "A-cancelled" },
  familyTaggedNoFamilyVisit: { _id: "r8", userId: P, doctorId: D, familyMemberId: F },
  familyAttachedForThatMember: { _id: "r9", userId: P, familyMemberId: F2 },
  familyOfAnotherMemberAttached: { _id: "r10", userId: P, familyMemberId: F },
};

await run("a doctor sees ONLY reports shared with them — never every report of the patient", () => {
  const appointments = [
    { _id: "A-paid", status: "payment_completed", reportIds: ["r4"], familyMemberId: null },
    { _id: "A-cancelled", status: "cancelled", reportIds: [] },
    { _id: "A-fam", status: "completed", reportIds: ["r9", "r10"], familyMemberId: F2 },
  ];
  const scope = buildSharedReportFilter({ patientId: P, doctorId: D, scope: buildSharedRecordScope(appointments) });
  const visible = Object.entries(reports).filter(([, r]) => matches(r, scope)).map(([k]) => k).sort();
  assert.deepEqual(visible, ["attachedAtBooking", "familyAttachedForThatMember", "linkedToPaidAppt", "taggedToDoctor"].sort());
  // explicit negatives
  for (const leaked of ["untaggedPrivate", "taggedToOtherDoctor", "otherPatient", "linkedToCancelled", "familyTaggedNoFamilyVisit", "familyOfAnotherMemberAttached"]) {
    assert.ok(!visible.includes(leaked), `${leaked} must not be visible`);
  }
});

await run("a family-member report is visible only via an appointment booked FOR that member", () => {
  const scopeF = buildSharedRecordScope([{ _id: "A1", status: "completed", familyMemberId: F, reportIds: [] }]);
  const filter = buildSharedReportFilter({ patientId: P, doctorId: D, scope: scopeF });
  assert.ok(matches(reports.familyTaggedNoFamilyVisit, filter), "tagged family report is visible once a visit for that member exists");
  const scopeSelf = buildSharedRecordScope([{ _id: "A1", status: "completed", familyMemberId: null, reportIds: [] }]);
  const filterSelf = buildSharedReportFilter({ patientId: P, doctorId: D, scope: scopeSelf });
  assert.ok(!matches(reports.familyTaggedNoFamilyVisit, filterSelf), "a visit for the account holder must not expose a family member's report");
});

await run("no eligible appointment => no report filter, no insurance filter, no family filter", () => {
  const scope = buildSharedRecordScope([{ _id: "x", status: "pending" }, { _id: "y", status: "cancelled" }, { _id: "z", status: "approved" }]);
  assert.equal(scope.hasAccess, false);
  assert.equal(buildSharedReportFilter({ patientId: P, doctorId: D, scope }), null);
  assert.equal(buildSharedInsuranceFilter({ patientId: P, scope }), null);
  assert.equal(buildSharedFamilyFilter({ patientId: P, scope }), null);
});

await run("insurance and family are limited to what the appointments actually reference", () => {
  const scope = buildSharedRecordScope([
    { _id: "A1", status: "completed", insuranceId: "ins-1", familyMemberId: F },
    { _id: "A2", status: "cancelled", insuranceId: "ins-2", familyMemberId: F2 },
  ]);
  assert.deepEqual(buildSharedInsuranceFilter({ patientId: P, scope }), { userId: P, _id: { $in: ["ins-1"] } });
  assert.deepEqual(buildSharedFamilyFilter({ patientId: P, scope }).$or ?? null, null);
  assert.deepEqual(buildSharedFamilyFilter({ patientId: P, scope })._id, { $in: [F] });
});

// ── record access decision (stubbed models) ──────────────────────────────
const approvedDoctor = { _id: D, verificationStatus: "approved", isVerified: true, isActive: true };
const stubPair = ({ patientActive = true, appointments = [] } = {}) => {
  User.findOne = () => ({ select: () => ({ lean: async () => (patientActive ? { _id: P } : null) }) });
  Appointment.find = () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => appointments }) }) }) });
};
const denied = async (fn) => {
  try { await fn(); } catch (error) { assert.ok(error instanceof AppError, "expected AppError"); assert.equal(error.statusCode, 403); return; }
  assert.fail("expected a 403");
};

await run("unapproved / rejected / pending / deactivated doctors are denied record access", async () => {
  stubPair({ appointments: [appt({})] });
  for (const bad of [
    { ...approvedDoctor, verificationStatus: "pending", isVerified: false },
    { ...approvedDoctor, verificationStatus: "rejected", isVerified: false },
    { ...approvedDoctor, verificationStatus: "not_submitted", isVerified: false },
    { ...approvedDoctor, isVerified: false },
    { ...approvedDoctor, isActive: false },
    null,
  ]) await denied(() => assertDoctorPatientRecordAccess(bad, P));
});

await run("deactivated / non-existent patient is denied", async () => {
  stubPair({ patientActive: false, appointments: [appt({})] });
  await denied(() => assertDoctorPatientRecordAccess(approvedDoctor, P));
});

await run("a doctor whose only appointments are pending/approved/cancelled is denied", async () => {
  // fetchPairAppointments already filters by status in the query; simulate the DB returning nothing.
  stubPair({ appointments: [] });
  await denied(() => assertDoctorPatientRecordAccess(approvedDoctor, P));
});

await run("the relationship query is scoped to this doctor + this patient + clinical statuses", async () => {
  let queried;
  User.findOne = () => ({ select: () => ({ lean: async () => ({ _id: P }) }) });
  Appointment.find = (filter) => { queried = filter; return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [appt({})] }) }) }) }; };
  const scope = await assertDoctorPatientRecordAccess(approvedDoctor, P);
  assert.equal(scope.hasAccess, true);
  assert.equal(queried.doctorId, D);
  assert.equal(queried.patientId, P);
  assert.deepEqual([...queried.status.$in].sort(), [...CLINICAL_RECORD_STATUSES].sort());
});

// ── chat ─────────────────────────────────────────────────────────────────
await run("chat eligibility: active statuses yes; pending/cancelled never; completed only inside the window", () => {
  const now = Date.now();
  for (const status of ["approved", "payment_pending", "payment_completed", "consultation_started", "consultation_completed"]) {
    assert.equal(chatEligibleFromAppointments([{ status, date: new Date(now - 400 * day) }], now, 30), true, status);
  }
  for (const status of ["pending", "cancelled", "rejected", "no_show"]) {
    assert.equal(chatEligibleFromAppointments([{ status, date: new Date(now) }], now, 30), false, status);
  }
  assert.equal(chatEligibleFromAppointments([{ status: "completed", date: new Date(now - 5 * day) }], now, 30), true);
  assert.equal(chatEligibleFromAppointments([{ status: "completed", date: new Date(now - 45 * day) }], now, 30), false);
  assert.equal(chatEligibleFromAppointments([{ status: "review_eligible", date: new Date(now - 45 * day) }], now, 30), false);
  assert.equal(chatEligibleFromAppointments([], now, 30), false);
});

const doctorUser = { _id: "u-doc", role: "doctor", isActive: true };
const patientUser = { _id: "u-pat", role: "patient", isActive: true };
const adminUser = { _id: "u-adm", role: "super_admin", isActive: true };
const stubChat = ({ doctor = approvedDoctor, appointments = [] } = {}) => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => doctor }) });
  Appointment.find = () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => appointments }) }) }) });
};

await run("usersCanChat: basic guards (self, patient-patient, deactivated participant)", async () => {
  assert.equal(await usersCanChat(doctorUser, doctorUser), false);
  assert.equal(await usersCanChat(patientUser, { _id: "u-pat2", role: "patient", isActive: true }), false);
  assert.equal(await usersCanChat(doctorUser, { ...patientUser, isActive: false }), false);
  assert.equal(await usersCanChat({ ...doctorUser, isActive: false }, patientUser), false);
});

await run("usersCanChat: super_admin support chat is always allowed (no DB)", async () => {
  assert.equal(await usersCanChat(adminUser, patientUser), true);
  assert.equal(await usersCanChat(doctorUser, adminUser), true);
});

await run("usersCanChat: cancelled/pending-only history no longer opens chat (the old bug)", async () => {
  stubChat({ appointments: [] }); // DB filters by status; nothing qualifies
  assert.equal(await usersCanChat(doctorUser, patientUser), false);
  stubChat({ appointments: [{ status: "cancelled", date: new Date() }] });
  assert.equal(await usersCanChat(doctorUser, patientUser), false);
  stubChat({ appointments: [{ status: "pending", date: new Date() }] });
  assert.equal(await usersCanChat(doctorUser, patientUser), false);
});

await run("usersCanChat: an unapproved or deactivated doctor cannot chat even with a paid appointment", async () => {
  const paid = [{ status: "payment_completed", date: new Date() }];
  for (const doctor of [{ ...approvedDoctor, verificationStatus: "rejected", isVerified: false }, { ...approvedDoctor, isActive: false }, null]) {
    stubChat({ doctor, appointments: paid });
    assert.equal(await usersCanChat(doctorUser, patientUser), false);
  }
});

await run("usersCanChat: active appointment with an eligible doctor is allowed (both directions)", async () => {
  stubChat({ appointments: [{ status: "approved", date: new Date() }] });
  assert.equal(await usersCanChat(doctorUser, patientUser), true);
  assert.equal(await usersCanChat(patientUser, doctorUser), true);
});

await run("history: a patient may still read their own past conversation after the follow-up window", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => approvedDoctor }) });
  let q;
  Appointment.exists = async (filter) => { q = filter; return { _id: "x" }; };
  assert.equal(await usersCanReadConversationHistory(patientUser, doctorUser), true);
  assert.equal(q.doctorId, D);
  assert.equal(q.patientId, "u-pat");
  Appointment.exists = async () => null;
  assert.equal(await usersCanReadConversationHistory(patientUser, doctorUser), false, "no qualifying relationship => no history");
});

await run("history: an ineligible doctor cannot read patient conversations", async () => {
  Doctor.findOne = () => ({ select: () => ({ lean: async () => ({ ...approvedDoctor, isActive: false }) }) });
  Appointment.exists = async () => ({ _id: "x" });
  assert.equal(await usersCanReadConversationHistory(doctorUser, patientUser), false);
});

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("clinicalAccessPolicy: all passed");
