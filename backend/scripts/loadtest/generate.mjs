// Pure deterministic document generators. No DB, no network, no provider SDKs.
// Every record is a function of (plan, index) so it can be regenerated and
// compared identically on every run. Ids are hex strings; Mongoose casts them.
import { createHash } from "node:crypto";
import { ROLES } from "../../constants/roles.js";
import { APPOINTMENT_STATUS as S, PAYMENT_STATUS as PS } from "../../constants/appointmentStatus.js";
import { VISIT_STATE as V, REASON_CODE as RC } from "../../constants/appointmentVisitState.js";
import { allocatePayout, calculateBill } from "../../payments/money.js";
import { CANONICAL_MASTER_SEEDS } from "../../master-data/canonicalSeed.js";
import { makeId, KIND } from "./ids.mjs";
import { makeRng } from "./rng.mjs";
import { DAY_MS, PAST_DAYS, FUTURE_DAYS, SLOT_LABELS, coprimeStep } from "./profile.mjs";

export const SYNTHETIC_NOTE = "LOAD TEST — synthetic note; not clinical guidance";
export const SPECIALIZATIONS = Object.freeze(CANONICAL_MASTER_SEEDS.filter((m) => m.kind === "specialization").map((m) => m.name));
const pad = (n, w = 6) => String(n).padStart(w, "0");
const HOUR = 3600000;
const MIN = 60000;

// ── id helpers ────────────────────────────────────────────────────────────
const USER_OFFSET = Object.freeze({ admin: 0, doctor: 1000000, patient: 2000000 });
export const adminUserId = (plan, i) => makeId(plan.ns, KIND.user, USER_OFFSET.admin + i);
export const doctorUserId = (plan, i) => makeId(plan.ns, KIND.user, USER_OFFSET.doctor + i);
export const patientUserId = (plan, i) => makeId(plan.ns, KIND.user, USER_OFFSET.patient + i);
export const doctorProfileId = (plan, i) => makeId(plan.ns, KIND.doctor, i);
// Deterministic subdocument ids (arrays of subdocs otherwise get random _ids and rerun churn).
export const subId = (plan, key) => `4c54${createHash("sha1").update(`${plan.ns}`).digest("hex").slice(0, 8)}${createHash("sha1").update(`${plan.ns}|${key}`).digest("hex").slice(0, 12)}`;

export const emailOf = (plan, role, i) => `${role}-${pad(i + 1)}@${plan.domain}`;

// ── doctor state distribution (per 100 doctors) ──────────────────────────
export const doctorStateOf = (i) => {
  const b = i % 100;
  return b < 65 ? "approved_active" : b < 70 ? "approved_inactive" : b < 85 ? "pending" : b < 93 ? "rejected" : "not_submitted";
};
export const doctorIndexFromPool = (p) => Math.floor(p / 65) * 100 + (p % 65);
export const doctorModes = (plan, i) => {
  const rng = makeRng(plan.seed, `doc-modes:${i}`);
  const modes = ["online", "offline", "home_visit"].filter(() => rng.chance(0.55));
  return modes.length ? modes : ["online"];
};
export const doctorFees = (plan, i) => 300 + 50 * makeRng(plan.seed, `doc-fee:${i}`).int(0, 50);

const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
    return out;
  }
  return value;
};

const ago = (plan, days, extraMs = 0) => new Date(plan.anchor.getTime() - days * DAY_MS - extraMs);

const CITIES = Object.freeze([
  { city: "Mumbai", state: "Maharashtra", district: "Mumbai", lat: 19.076, lng: 72.8777 },
  { city: "Delhi", state: "Delhi", district: "New Delhi", lat: 28.6139, lng: 77.209 },
  { city: "Bengaluru", state: "Karnataka", district: "Bengaluru Urban", lat: 12.9716, lng: 77.5946 },
  { city: "Chennai", state: "Tamil Nadu", district: "Chennai", lat: 13.0827, lng: 80.2707 },
  { city: "Kolkata", state: "West Bengal", district: "Kolkata", lat: 22.5726, lng: 88.3639 },
  { city: "Hyderabad", state: "Telangana", district: "Hyderabad", lat: 17.385, lng: 78.4867 },
  { city: "Pune", state: "Maharashtra", district: "Pune", lat: 18.5204, lng: 73.8567 },
  { city: "Ahmedabad", state: "Gujarat", district: "Ahmedabad", lat: 23.0225, lng: 72.5714 },
  { city: "Jaipur", state: "Rajasthan", district: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { city: "Lucknow", state: "Uttar Pradesh", district: "Lucknow", lat: 26.8467, lng: 80.9462 },
  { city: "Mathura", state: "Uttar Pradesh", district: "Mathura", lat: 27.4924, lng: 77.6737 },
  { city: "Bhopal", state: "Madhya Pradesh", district: "Bhopal", lat: 23.2599, lng: 77.4126 },
]);
const LANGS = ["English", "Hindi", "Bengali", "Tamil", "Telugu", "Marathi"];
const DAYS6 = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ── users ─────────────────────────────────────────────────────────────────
export const buildAdminUser = (plan, i, ctx) => ({
  _id: adminUserId(plan, i),
  name: `LOADTEST Synthetic Super Admin ${pad(i + 1)}`,
  email: emailOf(plan, "admin", i),
  password: ctx.passwordHash,
  role: ROLES.SUPER_ADMIN,
  isActive: true, emailVerified: true, securityVersion: 0,
  doctorOnboardingStatus: "not_started",
  createdAt: ago(plan, 420), updatedAt: ago(plan, 420),
});

export const buildDoctorUser = (plan, i, ctx) => {
  const state = doctorStateOf(i);
  const rng = makeRng(plan.seed, `doc-user:${i}`);
  const created = ago(plan, rng.int(200, 400));
  const reviewer = adminUserId(plan, i % plan.admins);
  const submittedAt = new Date(created.getTime() + 2 * DAY_MS);
  const reviewedAt = new Date(created.getTime() + 5 * DAY_MS);
  const onboarding = { approved_active: "approved", approved_inactive: "approved", pending: "pending", rejected: "rejected", not_submitted: "not_started" }[state];
  return clean({
    _id: doctorUserId(plan, i),
    name: `LOADTEST Synthetic Doctor ${pad(i + 1)}`,
    email: emailOf(plan, "doctor", i),
    password: ctx.passwordHash,
    role: ROLES.DOCTOR,
    isActive: state !== "approved_inactive",
    emailVerified: true, securityVersion: 0,
    doctorOnboardingStatus: onboarding,
    doctorVerification: state === "not_submitted" ? undefined : {
      submittedAt,
      reviewedAt: state === "pending" ? undefined : reviewedAt,
      reviewedBy: state === "pending" ? undefined : reviewer,
      rejectionReason: state === "rejected" ? "LOAD TEST — synthetic rejection; not a real review decision" : "",
    },
    createdAt: created, updatedAt: created,
  });
};

export const buildPatientUser = (plan, i, ctx) => {
  const rng = makeRng(plan.seed, `patient:${i}`);
  const created = ago(plan, rng.int(200, 400));
  const profile = {
    dateOfBirth: new Date(Date.UTC(1940 + rng.int(0, 70), rng.int(0, 11), rng.int(1, 28))),
    gender: rng.pick(["male", "female", "other", "prefer_not_to_say", ""]),
    bloodGroup: rng.chance(0.7) ? rng.pick(["A+", "A-", "B+", "B-", "AB+", "O+", "O-"]) : "",
    address: rng.chance(0.6) ? `LOAD TEST synthetic address ${pad(i + 1)}` : "",
    emergencyContact: rng.chance(0.5)
      ? { name: `LOADTEST Contact ${pad(i + 1)}`, phone: `0000${pad(i % 1000000)}`, relation: rng.pick(["spouse", "parent", "sibling", "friend"]) }
      : undefined,
    allergies: rng.chance(0.15) ? ["LOAD TEST synthetic placeholder"] : [],
    preferredSpecializations: rng.chance(0.3) ? [rng.pick(SPECIALIZATIONS)] : [],
    healthPreferences: { reminderOptIn: rng.chance(0.85), preferredConsultationMode: rng.pick(["in_person", "video", "either", ""]) },
  };
  return clean({
    _id: patientUserId(plan, i),
    name: `LOADTEST Synthetic Patient ${pad(i + 1)}`,
    email: emailOf(plan, "patient", i),
    password: ctx.passwordHash,
    role: ROLES.PATIENT,
    isActive: !rng.chance(0.02),
    emailVerified: !rng.chance(0.05), securityVersion: 0,
    doctorOnboardingStatus: "not_started",
    patientProfile: profile,
    createdAt: created, updatedAt: created,
  });
};

// ── doctor profile ────────────────────────────────────────────────────────
export const buildDoctorProfile = (plan, i, ctx) => {
  const state = doctorStateOf(i);
  const rng = makeRng(plan.seed, `doc-profile:${i}`);
  const created = ago(plan, rng.int(200, 400));
  const specialization = SPECIALIZATIONS[(i * 7 + rng.int(0, SPECIALIZATIONS.length - 1)) % SPECIALIZATIONS.length];
  const masterId = ctx.specializationMasterIds?.get(specialization) || null;
  const city = CITIES[rng.int(0, CITIES.length - 1)];
  const experience = rng.int(1, 40);
  const modes = doctorModes(plan, i);
  const approved = state === "approved_active" || state === "approved_inactive";
  const reviewer = adminUserId(plan, i % plan.admins);
  const submittedAt = new Date(created.getTime() + 2 * DAY_MS);
  const reviewedAt = new Date(created.getTime() + 5 * DAY_MS);
  const history = [];
  if (state !== "not_submitted") history.push({ _id: subId(plan, `dh:${i}:0`), status: "pending", notes: "LOAD TEST synthetic submission", changedBy: doctorUserId(plan, i), changedAt: submittedAt });
  if (approved) history.push({ _id: subId(plan, `dh:${i}:1`), status: "approved", notes: "LOAD TEST synthetic approval", changedBy: reviewer, changedAt: reviewedAt });
  if (state === "rejected") history.push({ _id: subId(plan, `dh:${i}:1`), status: "rejected", notes: "LOAD TEST synthetic rejection", changedBy: reviewer, changedAt: reviewedAt });
  return clean({
    _id: doctorProfileId(plan, i),
    userId: doctorUserId(plan, i),
    specialization,
    specializationMasterId: masterId,
    specializationType: masterId ? "MASTER" : "OTHER",
    specializationOther: masterId ? "" : specialization,
    experience,
    fees: doctorFees(plan, i),
    availability: DAYS6.map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "14:00", slotDurationMinutes: 30, bufferMinutes: 0, maxPatientsPerSlot: 1, emergencySlotsPerDay: 0, timeSlots: [...SLOT_LABELS], breaks: [] })),
    licenseNumber: `LT-LIC-${pad(i + 1)}`,
    medicalCouncil: "LOAD TEST Council (synthetic)",
    qualification: "MBBS (synthetic)",
    collegeName: "LOAD TEST Medical College (synthetic)",
    graduationYear: plan.anchor.getUTCFullYear() - experience - 5,
    hospitalName: `LOAD TEST Clinic ${pad(i + 1)}`,
    city: city.city, cityType: "OTHER", cityOther: city.city,
    state: city.state, stateType: "OTHER", stateOther: city.state,
    district: city.district, districtType: "OTHER", districtOther: city.district,
    location: { type: "Point", coordinates: [Number((city.lng + (rng.next() - 0.5) * 0.3).toFixed(5)), Number((city.lat + (rng.next() - 0.5) * 0.3).toFixed(5))] },
    bio: "LOAD TEST — synthetic doctor profile; not a real clinician.",
    languages: LANGS.filter(() => rng.chance(0.4)).concat(["English"]).filter((v, k, a) => a.indexOf(v) === k),
    consultationMode: modes,
    profilePhoto: "",
    isVerified: approved,
    isActive: state !== "approved_inactive",
    verificationStatus: approved ? "approved" : state,
    verificationNotes: approved ? "LOAD TEST synthetic approval" : state === "rejected" ? "LOAD TEST synthetic rejection" : "",
    verifiedBy: approved ? reviewer : undefined,
    verifiedAt: approved ? reviewedAt : undefined,
    verificationHistory: history,
    rating: ctx.ratings?.get(i) ?? 0,
    createdAt: created, updatedAt: created,
  });
};

// ── calendar + deterministic slot allocator ──────────────────────────────
export const buildCalendar = (plan) => {
  const offsets = [];
  for (let o = -PAST_DAYS; o <= FUTURE_DAYS; o += 1) {
    if (new Date(plan.anchor.getTime() + o * DAY_MS).getUTCDay() !== 0) offsets.push(o); // clinics closed Sundays
  }
  return Object.freeze({ offsets, stride: coprimeStep(offsets.length, 37), capacityPerDoctor: offsets.length * SLOT_LABELS.length });
};

// Appointment index a -> unique (doctor pool slot p, day, slot). For a given doctor the
// mapping j -> (dayIdx, slotIdx) is injective for j < capacityPerDoctor.
export const allocateSlot = (plan, cal, a) => {
  const p = a % plan.pool;
  const j = Math.floor(a / plan.pool);
  const L = cal.offsets.length;
  const dayIdx = (j * cal.stride + ((p * 97 + 13) % L)) % L;
  const slotIdx = (Math.floor(j / L) + (p % SLOT_LABELS.length)) % SLOT_LABELS.length;
  return { p, doctorIdx: doctorIndexFromPool(p), offset: cal.offsets[dayIdx], timeSlot: SLOT_LABELS[slotIdx], slotKey: `${p}|${dayIdx}|${slotIdx}` };
};

// ── scenarios ─────────────────────────────────────────────────────────────
const PAST_MIX = [["completed_paid", 50], ["review_eligible_paid", 12], ["cancelled_unpaid", 7], ["cancelled_refund_processed", 4], ["cancelled_refund_pending", 2], ["cancelled_failed_payment", 2], ["no_show_patient", 6], ["missed_unresolved", 6], ["consultation_completed", 4], ["consultation_started_stale", 2], ["cancelled_expired_payment", 5]];
const TODAY_MIX = [["pending", 15], ["approved", 18], ["payment_pending", 15], ["payment_completed", 30], ["consultation_started", 12], ["completed_paid", 10]];
const FUTURE_MIX = [["pending", 22], ["approved", 20], ["payment_pending", 13], ["payment_failed_retriable", 5], ["payment_completed", 30], ["cancelled_unpaid", 6], ["cancelled_refund_pending", 2], ["cancelled_refund_processed", 2]];
export const chooseScenario = (rng, offset) => rng.weighted(offset < 0 ? PAST_MIX : offset === 0 ? TODAY_MIX : FUTURE_MIX);

const CHAIN = [S.PENDING, S.APPROVED, S.PAYMENT_PENDING, S.PAYMENT_COMPLETED, S.CONSULTATION_STARTED, S.CONSULTATION_COMPLETED, S.COMPLETED, S.REVIEW_ELIGIBLE];
const CHAIN_ROLE = { pending: "patient", approved: "doctor", payment_pending: "system", payment_completed: "system", consultation_started: "doctor", consultation_completed: "doctor", completed: "system", review_eligible: "system" };

const modeOf = (m) => (m === "offline" ? "in_person" : m);

export const emptyBundle = () => ({ appointments: [], payments: [], invoices: [], payouts: [], ledger: [], refunds: [], notes: [], prescriptions: [], reviews: [], notifications: [], reminders: [], chats: [] });

export const buildAppointmentBundle = (plan, cal, a) => {
  const out = emptyBundle();
  const slot = allocateSlot(plan, cal, a);
  const rng = makeRng(plan.seed, `appt:${a}`);
  const docIdx = slot.doctorIdx;
  const pStep = coprimeStep(plan.patients, 7919);
  const patientIdx = (a * pStep) % plan.patients;
  const patientId = patientUserId(plan, patientIdx);
  const doctorUser = doctorUserId(plan, docIdx);
  const doctorId = doctorProfileId(plan, docIdx);
  const apptId = makeId(plan.ns, KIND.appointment, a);
  const offset = slot.offset;
  const date = new Date(plan.anchor.getTime() + offset * DAY_MS);
  const startMin = Number(slot.timeSlot.slice(0, 2)) * 60 + Number(slot.timeSlot.slice(3, 5));
  const instant = new Date(date.getTime() + (startMin - 330) * MIN); // slot is hospital (IST) wall-clock
  const scenario = chooseScenario(rng, offset);
  const createdAt = offset < 0 ? new Date(date.getTime() - rng.int(1, 14) * DAY_MS) : ago(plan, rng.int(1, 10));

  // scenario table → what exists
  const T = {
    pending: { status: S.PENDING }, approved: { status: S.APPROVED },
    payment_pending: { status: S.PAYMENT_PENDING, pay: "pending" },
    payment_failed_retriable: { status: S.PAYMENT_PENDING, pay: "failed_retriable" },
    payment_completed: { status: S.PAYMENT_COMPLETED, pay: "paid" },
    consultation_started: { status: S.CONSULTATION_STARTED, pay: "paid" },
    consultation_started_stale: { status: S.CONSULTATION_STARTED, pay: "paid" },
    consultation_completed: { status: S.CONSULTATION_COMPLETED, pay: "paid" },
    completed_paid: { status: S.COMPLETED, pay: "paid" },
    review_eligible_paid: { status: S.REVIEW_ELIGIBLE, pay: "paid" },
    missed_unresolved: { status: S.PAYMENT_COMPLETED, pay: "paid" },
    no_show_patient: { status: S.CANCELLED, prev: S.PAYMENT_COMPLETED, pay: "paid" },
    cancelled_unpaid: { status: S.CANCELLED, prev: rng.chance(0.5) ? S.PENDING : S.APPROVED },
    cancelled_failed_payment: { status: S.CANCELLED, prev: S.PAYMENT_PENDING, pay: "failed_final" },
    cancelled_expired_payment: { status: S.CANCELLED, prev: S.PAYMENT_PENDING, pay: "expired" },
    cancelled_refund_processed: { status: S.CANCELLED, prev: S.PAYMENT_COMPLETED, pay: "refund_processed" },
    cancelled_refund_pending: { status: S.CANCELLED, prev: S.PAYMENT_COMPLETED, pay: rng.chance(0.75) ? "refund_pending" : "refund_rejected" },
  }[scenario];
  const status = T.status;
  const paid = ["paid", "refund_processed", "refund_pending", "refund_rejected"].includes(T.pay);
  const payId = makeId(plan.ns, KIND.payment, a);
  const invId = makeId(plan.ns, KIND.invoice, a);
  const fee = doctorFees(plan, docIdx);
  const bill = calculateBill({ subtotal: fee, taxRate: plan.taxRatePercent });
  const paidAt = new Date(createdAt.getTime() + 5 * HOUR);

  // status history (chain up to current/previous status)
  const upto = status === S.CANCELLED ? T.prev : status;
  const history = CHAIN.slice(0, CHAIN.indexOf(upto) + 1).map((st, k, arr) => ({
    _id: subId(plan, `ah:${a}:${k}`), status: st, fromStatus: k ? arr[k - 1] : "", actorRole: CHAIN_ROLE[st],
    reason: "LOAD TEST synthetic transition", at: new Date(createdAt.getTime() + k * HOUR),
  }));
  const cancelSource = scenario === "cancelled_expired_payment" ? "system" : scenario === "no_show_patient" ? "doctor" : rng.chance(0.8) ? "patient" : "doctor";
  const cancelCode = scenario === "cancelled_expired_payment" ? RC.PAYMENT_WINDOW_EXPIRED : scenario === "no_show_patient" ? RC.PATIENT_NO_SHOW : cancelSource === "patient" ? RC.PATIENT_CANCELLED : RC.DOCTOR_CANCELLED;
  const cancelledAt = new Date(Math.min(instant.getTime() - HOUR, createdAt.getTime() + 30 * HOUR));
  const cancelledAtFinal = scenario === "no_show_patient" ? new Date(instant.getTime() + 30 * MIN) : cancelledAt;
  if (status === S.CANCELLED) history.push({ _id: subId(plan, `ah:${a}:c`), status: S.CANCELLED, fromStatus: T.prev, actorRole: cancelSource, reason: "LOAD TEST synthetic cancellation", reasonCode: cancelCode, at: cancelledAtFinal });

  const offered = doctorModes(plan, docIdx).map(modeOf);
  const consultationMode = offered[rng.int(0, offered.length - 1)];
  let visit = { state: V.NOT_ARRIVED };
  let resolution;
  const started = new Date(instant.getTime() + rng.int(0, 10) * MIN);
  const ended = new Date(started.getTime() + rng.int(15, 30) * MIN);
  if ([S.COMPLETED, S.REVIEW_ELIGIBLE, S.CONSULTATION_COMPLETED].includes(status)) visit = { state: V.COMPLETED, checkedInAt: new Date(instant.getTime() - 5 * MIN), consultationStartedAt: started, consultationEndedAt: ended };
  else if (status === S.CONSULTATION_STARTED) visit = { state: V.IN_CONSULTATION, checkedInAt: new Date(instant.getTime() - 5 * MIN), consultationStartedAt: started };
  else if (scenario === "missed_unresolved") { visit = { state: V.MISSED }; resolution = { flaggedAt: new Date(instant.getTime() + HOUR) }; }
  else if (scenario === "no_show_patient") visit = { state: V.NO_SHOW_PATIENT, noShowAt: cancelledAtFinal };

  const paymentStatus = !T.pay ? PS.PENDING
    : T.pay === "paid" || T.pay === "refund_pending" || T.pay === "refund_rejected" ? PS.PAID
    : T.pay === "refund_processed" ? PS.REFUNDED
    : T.pay === "failed_retriable" || T.pay === "failed_final" ? PS.FAILED : PS.PENDING;

  const appt = {
    _id: apptId, patientId, doctorId, date, timeSlot: slot.timeSlot, status, paymentStatus,
    notes: "LOAD TEST — synthetic appointment; not clinical guidance",
    consultationMode,
    reason: "LOAD TEST synthetic visit reason",
    appointmentType: rng.chance(0.15) ? "follow_up" : "consultation",
    bookedBy: "patient",
    bookingRequestId: `lt:${plan.ns}:appt:${a}`,
    statusHistory: history, visit, resolution,
    visitAddress: consultationMode === "home_visit" ? { line1: "LOAD TEST synthetic address", city: "Synthetic City", postalCode: "000000" } : undefined,
    paymentId: T.pay ? payId : undefined,
    invoiceId: paid ? invId : undefined,
    paidAt: paid ? paidAt : undefined,
    paymentPendingAt: T.pay ? new Date(createdAt.getTime() + 2 * HOUR) : undefined,
    cancelReason: status === S.CANCELLED ? "LOAD TEST synthetic cancellation" : "",
    cancellation: status === S.CANCELLED ? { source: cancelSource, reasonCode: cancelCode, previousStatus: T.prev, scheduledInstant: instant, cancelledAt: cancelledAtFinal } : undefined,
    createdAt, updatedAt: status === S.CANCELLED ? cancelledAtFinal : new Date(Math.max(createdAt.getTime(), Math.min(instant.getTime(), plan.anchor.getTime()))),
  };
  out.appointments.push(clean(appt));
  out._meta = { scenario, status, paymentStatus, offset, patientIdx, docIdx, slotKey: slot.slotKey, key: `${docIdx}|${offset}|${slot.timeSlot}` };

  // ── payment family ──────────────────────────────────────────────────────
  if (T.pay) {
    const base = {
      _id: payId, appointmentId: apptId, userId: patientId, doctorId,
      amount: bill.taxableSubtotal, discountAmount: 0, taxAmount: bill.tax, totalAmount: bill.total,
      gatewayAmount: bill.total, walletAmount: 0, currency: "INR", gateway: "razorpay",
      razorpayOrderId: `lt_order_${plan.ns}_${a}`, gatewayOrderId: `lt_order_${plan.ns}_${a}`,
      idempotencyKey: `lt:${plan.ns}:pay:${a}`, retryCount: 0, refundStatus: "none", refundedAmount: 0,
      walletRefundedAmount: 0, gatewayRefundedAmount: 0, reconciliationState: "not_required", retryResolution: "open",
      metadata: { loadTestNamespace: plan.ns, synthetic: true, baseAmount: fee, taxRate: plan.taxRatePercent },
      createdAt: new Date(createdAt.getTime() + 2 * HOUR), updatedAt: paid ? paidAt : new Date(createdAt.getTime() + 2 * HOUR),
    };
    const sh = (from, to, at) => ({ _id: subId(plan, `ps:${a}:${to}`), from, to, source: "system", reason: "LOAD TEST synthetic", at });
    if (T.pay === "pending") {
      const st = rng.pick(["created", "order_created", "pending", "checkout_started"]);
      out.payments.push(clean({ ...base, status: st, paymentState: st, activeAppointmentSlot: true, postProcessingState: "pending", stateHistory: [sh(null, st, base.createdAt)] }));
    } else if (T.pay === "failed_retriable" || T.pay === "failed_final") {
      const failedAt = new Date(createdAt.getTime() + 3 * HOUR);
      out.payments.push(clean({ ...base, status: "failed", paymentState: "failed", retryCount: T.pay === "failed_final" ? 3 : 1, activeAppointmentSlot: T.pay === "failed_retriable" ? true : undefined, failedAt, postProcessingState: "pending", updatedAt: failedAt, stateHistory: [sh(null, "failed", failedAt)] }));
    } else if (T.pay === "expired") {
      out.payments.push(clean({ ...base, status: "expired", paymentState: "expired", postProcessingState: "pending", stateHistory: [sh(null, "expired", base.createdAt)] }));
    } else {
      // captured + post-processed payment with its full required family
      const refundProcessed = T.pay === "refund_processed";
      const refundOpen = T.pay === "refund_pending";
      const payStatus = refundProcessed ? "refunded" : "completed";
      const payment = {
        ...base, status: payStatus, paymentState: payStatus, invoiceId: invId, paidAt,
        gatewayPaymentId: `lt_pay_${plan.ns}_${a}`, paymentId: `lt_pay_${plan.ns}_${a}`,
        capturedAttemptNumber: 1, capturedGatewayOrderId: `lt_order_${plan.ns}_${a}`, postProcessingState: "complete",
        refundStatus: refundProcessed ? "full" : refundOpen ? "pending" : "none",
        refundedAmount: refundProcessed ? bill.total : 0, gatewayRefundedAmount: refundProcessed ? bill.total : 0,
        processedGatewayRefundIds: refundProcessed ? [`lt_rfnd_${plan.ns}_${a}`] : [],
        stateHistory: [sh(null, "captured", paidAt), sh("captured", "completed", paidAt)],
      };
      out.payments.push(clean(payment));
      out.invoices.push(clean({
        _id: invId, invoiceNumber: `LT-${plan.ns.toUpperCase()}-${pad(a, 8)}`, paymentId: payId, appointmentId: apptId, billingType: "consultation",
        userId: patientId, doctorId, hospital: { name: "LOAD TEST Synthetic Hospital" },
        patient: { name: `LOADTEST Synthetic Patient ${pad(patientIdx + 1)}`, email: emailOf(plan, "patient", patientIdx) },
        doctor: { name: `LOADTEST Synthetic Doctor ${pad(docIdx + 1)}`, email: emailOf(plan, "doctor", docIdx), specialization: "Synthetic" },
        lineItems: [{ _id: subId(plan, `li:${a}`), description: "Consultation (LOAD TEST synthetic)", quantity: 1, unitAmount: bill.subtotal, total: bill.subtotal }],
        subtotal: bill.subtotal, taxAmount: bill.tax, totalAmount: bill.total, currency: "INR", status: "issued",
        metadata: { loadTestNamespace: plan.ns, synthetic: true }, issuedAt: paidAt, createdAt: paidAt, updatedAt: paidAt,
      }));
      const split = allocatePayout(bill.total, plan.platformFeePercent);
      const settled = !refundProcessed && offset <= -21 && [S.COMPLETED, S.REVIEW_ELIGIBLE].includes(status);
      const settledAt = new Date(instant.getTime() + 3 * DAY_MS);
      out.payouts.push(clean({
        _id: makeId(plan.ns, KIND.payout, a), doctorId, paymentId: payId, appointmentId: apptId, ...split,
        status: refundProcessed ? "cancelled" : settled ? "paid" : "pending",
        cancelReason: refundProcessed ? "LOAD TEST synthetic refund" : undefined,
        paidAt: settled ? settledAt : undefined, settledBy: settled ? adminUserId(plan, a % plan.admins) : undefined,
        createdAt: paidAt, updatedAt: settled ? settledAt : paidAt,
      }));
      out.ledger.push(clean({
        _id: makeId(plan.ns, KIND.ledger, a * 2), userId: patientId, paymentId: payId, type: "payment", direction: "debit", amount: bill.total, currency: "INR", status: "posted",
        referenceId: `lt_pay_${plan.ns}_${a}`, idempotencyKey: `lt:${plan.ns}:ledger:pay:${a}`, metadata: { loadTestNamespace: plan.ns, synthetic: true },
        createdAt: paidAt, updatedAt: paidAt,
      }));
      if (refundProcessed || refundOpen || T.pay === "refund_rejected") {
        const reqAt = new Date(cancelledAtFinal.getTime() + HOUR);
        const doneAt = new Date(reqAt.getTime() + 6 * HOUR);
        const spec = refundProcessed ? { status: "processed", refundState: "processed", gatewayRefundStatus: "processed", gatewayRefundId: `lt_rfnd_${plan.ns}_${a}` }
          : refundOpen ? { status: "pending", refundState: "pending_review" } : { status: "rejected", refundState: "rejected" };
        out.refunds.push(clean({
          _id: makeId(plan.ns, KIND.refund, a), paymentId: payId, requestedBy: patientId,
          processedBy: refundProcessed || T.pay === "refund_rejected" ? adminUserId(plan, a % plan.admins) : undefined,
          amount: bill.total, reason: "LOAD TEST synthetic refund request", reasonCode: RC.PATIENT_CANCELLED, entryPoint: "cancellation",
          walletRefundAmount: 0, gatewayRefundAmount: refundProcessed ? bill.total : 0, ...spec,
          stateHistory: [{ _id: subId(plan, `rs:${a}`), from: "requested", to: spec.refundState, source: "system", reason: "LOAD TEST synthetic", at: reqAt }],
          timeline: [{ _id: subId(plan, `rt:${a}`), status: spec.status, note: "LOAD TEST synthetic", at: reqAt }],
          createdAt: reqAt, updatedAt: refundProcessed ? doneAt : reqAt,
        }));
        if (refundProcessed) {
          out.ledger.push(clean({
            _id: makeId(plan.ns, KIND.ledger, a * 2 + 1), userId: patientId, paymentId: payId, type: "refund", direction: "credit", amount: bill.total, currency: "INR", status: "posted",
            referenceId: `lt_rfnd_${plan.ns}_${a}`, idempotencyKey: `lt:${plan.ns}:ledger:refund:${a}`, metadata: { loadTestNamespace: plan.ns, synthetic: true }, createdAt: doneAt, updatedAt: doneAt,
          }));
        }
      }
    }
  }

  // ── clinical: only for appointments that genuinely were consulted ───────
  const consulted = [S.COMPLETED, S.REVIEW_ELIGIBLE, S.CONSULTATION_COMPLETED].includes(status);
  const reviewable = [S.COMPLETED, S.REVIEW_ELIGIBLE].includes(status);
  let hasReview = false; let hasRx = false;
  if (consulted && rng.chance(0.7)) {
    out.notes.push(clean({ _id: makeId(plan.ns, KIND.note, a), doctorId, patientId, appointmentId: apptId, symptoms: ["LOAD TEST synthetic symptom"], notes: SYNTHETIC_NOTE, recommendations: SYNTHETIC_NOTE, createdAt: ended, updatedAt: ended }));
  }
  if (reviewable && rng.chance(0.55)) {
    hasRx = true;
    const rxAt = new Date(ended.getTime() + 10 * MIN);
    out.prescriptions.push(clean({
      _id: makeId(plan.ns, KIND.prescription, a), doctorId, patientId, appointmentId: apptId,
      diagnosis: "LOAD TEST — synthetic diagnosis placeholder",
      medicines: [{ _id: subId(plan, `rx:${a}`), name: "LOADTEST-PLACEHOLDER-MED-A", dosage: "n/a (synthetic)", frequency: "n/a (synthetic)", duration: "n/a (synthetic)", instructions: SYNTHETIC_NOTE }],
      notes: SYNTHETIC_NOTE, followUpDate: rng.chance(0.25) ? new Date(date.getTime() + 14 * DAY_MS) : undefined,
      status: rng.chance(0.08) ? "void" : "active", createdAt: rxAt, updatedAt: rxAt,
    }));
  }
  if (reviewable && rng.chance(status === S.REVIEW_ELIGIBLE ? 0.65 : 0.08)) {
    hasReview = true;
    const deleted = rng.chance(0.03);
    const revAt = new Date(instant.getTime() + 2 * DAY_MS);
    out.reviews.push(clean({
      _id: makeId(plan.ns, KIND.review, a), userId: patientId, doctorId, appointmentId: apptId,
      rating: rng.weighted([[5, 45], [4, 28], [3, 12], [2, 8], [1, 7]]), comment: "LOAD TEST — synthetic review text.",
      adminDeleted: deleted, adminDeletedAt: deleted ? new Date(revAt.getTime() + DAY_MS) : undefined, adminDeletedBy: deleted ? adminUserId(plan, a % plan.admins) : undefined,
      doctorReply: !deleted && rng.chance(0.2) ? { message: "LOAD TEST — synthetic reply.", repliedAt: new Date(revAt.getTime() + HOUR) } : undefined,
      createdAt: revAt, updatedAt: revAt,
    }));
  }

  // ── notifications (unique eventKey per recipient) ───────────────────────
  const readP = offset < 0 ? 0.8 : 0.3;
  const notif = (k, recipientId, type, title, severity, at) => {
    const read = rng.chance(readP);
    out.notifications.push(clean({
      _id: makeId(plan.ns, KIND.notification, a * 8 + k), recipientId, type, title: `${title} (LOAD TEST)`, message: "Synthetic notification — LOAD TEST dataset.",
      entityType: "appointment", entityId: apptId, severity, deliveredAt: at, readAt: read ? new Date(at.getTime() + 2 * HOUR) : undefined,
      eventKey: `lt:${plan.ns}:n:${a}:${k}`, metadata: { loadTestNamespace: plan.ns }, createdAt: at, updatedAt: at,
    }));
  };
  notif(0, doctorUser, "appointment", "New appointment request", "info", createdAt);
  if (status !== S.PENDING) notif(1, patientId, "appointment", status === S.CANCELLED ? "Appointment cancelled" : "Appointment update", status === S.CANCELLED ? "warning" : "info", new Date(createdAt.getTime() + HOUR));
  if (paid) notif(2, patientId, "payment", "Payment received", "success", paidAt);
  else if (T.pay === "failed_retriable" || T.pay === "failed_final") notif(2, patientId, "payment", "Payment failed", "warning", new Date(createdAt.getTime() + 3 * HOUR));
  if (T.pay === "refund_processed" || T.pay === "refund_pending") notif(3, patientId, "refund", T.pay === "refund_processed" ? "Refund processed" : "Refund requested", "info", cancelledAtFinal);
  if (hasReview) notif(4, doctorUser, "review", "New review", "info", new Date(instant.getTime() + 2 * DAY_MS));
  if (hasRx) notif(5, patientId, "prescription", "Prescription issued", "info", ended);

  // ── reminders (scheduler / reminder views) ──────────────────────────────
  const remAt = new Date(instant.getTime() - 24 * HOUR);
  const remActive = [S.PENDING, S.APPROVED, S.PAYMENT_COMPLETED].includes(status) && offset >= 0;
  const remPast = consulted || [S.PAYMENT_COMPLETED].includes(status);
  if (remActive || remPast) {
    const st = remActive ? "pending" : rng.weighted([["sent", 80], ["skipped", 15], ["failed", 5]]);
    out.reminders.push(clean({
      _id: makeId(plan.ns, KIND.reminder, a * 4), userId: patientId, entityType: "appointment", entityId: apptId, channel: "in_app", reminderType: "appointment_upcoming",
      status: st, scheduledFor: remAt, sentAt: st === "sent" ? remAt : undefined, failureReason: st === "failed" ? "LOAD TEST synthetic failure" : undefined,
      eventKey: `lt:${plan.ns}:r:${a}:0`, metadata: { loadTestNamespace: plan.ns }, createdAt: new Date(remAt.getTime() - HOUR), updatedAt: remAt,
    }));
  }
  if (T.pay === "pending") {
    out.reminders.push(clean({
      _id: makeId(plan.ns, KIND.reminder, a * 4 + 1), userId: patientId, entityType: "payment", entityId: payId, channel: "in_app", reminderType: "payment_due", status: "pending",
      scheduledFor: new Date(createdAt.getTime() + 6 * HOUR), eventKey: `lt:${plan.ns}:r:${a}:1`, metadata: { loadTestNamespace: plan.ns }, createdAt, updatedAt: createdAt,
    }));
  }

  // ── chat (only where a real, non-refunded care relationship exists) ─────
  if (["paid"].includes(T.pay) && rng.chance(0.4)) {
    const n = rng.int(2, 4);
    const key = [patientId, doctorUser].sort().join(":");
    for (let k = 0; k < n; k += 1) {
      const sentAt = new Date(paidAt.getTime() + (k + 1) * 10 * MIN);
      const fromPatient = k % 2 === 0;
      out.chats.push(clean({
        _id: makeId(plan.ns, KIND.chat, a * 8 + k), conversationKey: key, appointmentId: apptId,
        senderId: fromPatient ? patientId : doctorUser, recipientId: fromPatient ? doctorUser : patientId,
        messageType: "text", body: `LOAD TEST — synthetic message ${k + 1}`, clientMessageId: `lt:${plan.ns}:c:${a}:${k}`,
        sentAt, deliveredAt: sentAt, readAt: k < n - 1 || rng.chance(0.5) ? new Date(sentAt.getTime() + 5 * MIN) : undefined, createdAt: sentAt, updatedAt: sentAt,
      }));
    }
  }
  return out;
};

// ── patient/doctor + ops side data ──────────────────────────────────────
export const buildSavedDoctors = (plan, patientIdx) => {
  const rng = makeRng(plan.seed, `saved:${patientIdx}`);
  const n = rng.int(0, plan.savedPerPatient * 2);
  const seen = new Set(); const out = [];
  if (plan.pool === 0) return out;
  for (let k = 0; k < n; k += 1) {
    const di = doctorIndexFromPool(rng.int(0, plan.pool - 1));
    if (seen.has(di)) continue; seen.add(di);
    const at = ago(plan, rng.int(1, 120));
    out.push(clean({
      _id: makeId(plan.ns, KIND.saved, patientIdx * 8 + k), userId: patientUserId(plan, patientIdx), doctorId: doctorProfileId(plan, di),
      notes: "", tags: [], isPrimaryPhysician: seen.size === 1 && rng.chance(0.3), feesAtSave: doctorFees(plan, di), specializationAtSave: "Synthetic",
      createdAt: at, updatedAt: at,
    }));
  }
  return out;
};

const ADMIN_ACTIONS = ["loadtest.doctor.review", "loadtest.appointment.view", "loadtest.refund.review", "loadtest.settings.view", "loadtest.export"];
const RESOURCES = ["doctor", "appointment", "refund", "settings", "patient"];
export const buildAdminLog = (plan, n) => {
  const rng = makeRng(plan.seed, `adminlog:${n}`);
  const at = ago(plan, rng.next() * 120);
  return clean({ _id: makeId(plan.ns, KIND.adminlog, n), actorId: adminUserId(plan, n % plan.admins), action: rng.pick(ADMIN_ACTIONS), resourceType: rng.pick(RESOURCES), resourceId: `lt-${n}`, severity: rng.weighted([["info", 85], ["warning", 12], ["critical", 3]]), metadata: { loadTestNamespace: plan.ns, synthetic: true }, createdAt: at, updatedAt: at });
};
const CRON_JOBS = ["appointment-lifecycle", "reminder-dispatch", "payment-reconcile", "payout-sweep"];
export const buildCronLog = (plan, n) => {
  const rng = makeRng(plan.seed, `cron:${n}`);
  const startedAt = ago(plan, rng.next() * 60);
  const durationMs = rng.int(40, 20000);
  const status = rng.weighted([["success", 88], ["failed", 8], ["timed_out", 4]]);
  return clean({ _id: makeId(plan.ns, KIND.cron, n), jobName: `loadtest:${plan.ns}:${rng.pick(CRON_JOBS)}`, status, triggeredBy: "cron-script", startedAt, finishedAt: new Date(startedAt.getTime() + durationMs), durationMs, summary: { loadTestNamespace: plan.ns, synthetic: true }, error: status === "success" ? undefined : "LOAD TEST synthetic failure", createdAt: startedAt, updatedAt: startedAt });
};
export const buildAutomationLog = (plan, n) => {
  const rng = makeRng(plan.seed, `auto:${n}`);
  const startedAt = ago(plan, rng.next() * 60);
  const status = rng.weighted([["success", 70], ["failed", 10], ["skipped", 12], ["blocked", 8]]);
  return clean({ _id: makeId(plan.ns, KIND.automation, n), sourceKind: "automation_flow", triggerType: "loadtest.synthetic", triggerPayload: { loadTestNamespace: plan.ns, synthetic: true }, dryRun: rng.chance(0.2), status, conditionsMatched: status !== "skipped", error: status === "failed" ? "LOAD TEST synthetic failure" : undefined, startedAt, durationMs: rng.int(5, 3000), triggeredBy: rng.weighted([["event", 70], ["simulator", 20], ["manual", 10]]), createdAt: startedAt, updatedAt: startedAt });
};
