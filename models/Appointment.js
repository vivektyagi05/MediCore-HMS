import mongoose from "mongoose";
import {
  ACTIVE_STATUSES,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_VALUES,
  PAYMENT_STATUS,
  PAYMENT_STATUS_VALUES,
} from "../constants/appointmentStatus.js";

const appointmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    familyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyMember",
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    timeSlot: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: APPOINTMENT_STATUS_VALUES,
      default: APPOINTMENT_STATUS.PENDING,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    paymentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Payment",
      },

      invoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Invoice",
      },

      paidAt: Date,

      // BUGFIX: cancelAppointment sets this, but it was never declared on the
      // schema — Mongoose strict mode silently drops undeclared fields on
      // save, so every cancellation reason a patient provided was lost.
      cancelReason: {
        type: String,
        default: "",
      },

      // ── Appointment Journey (Phase A3) — additive visit-intake fields ──
      // All optional/defaulted so every pre-existing Appointment document
      // and every existing consumer (admin/doctor views, exports, AI
      // insights) keeps working completely unmodified. Nothing here
      // replaces `notes`, which remains the free-text field it always was.
      consultationMode: {
        // Canonical values — see backend/constants/consultationMode.js for
        // the full Doctor <-> Appointment contract. "home_visit" was always
        // a real, offerable Doctor mode but had never actually been
        // reachable here (validateAppointmentCreate rejected it just like
        // it rejected the Doctor-side "offline" value).
        type: String,
        enum: ["online", "in_person", "home_visit", ""],
        default: "",
      },
      reason: {
        type: String,
        trim: true,
        maxlength: 300,
        default: "",
      },
      symptoms: {
        type: [String],
        default: [],
      },
      symptomDuration: {
        type: String,
        trim: true,
        maxlength: 60,
        default: "",
      },
      painLevel: {
        type: Number,
        min: 0,
        max: 10,
      },
      hasPreviousConsultation: {
        type: Boolean,
        default: false,
      },
      existingConditions: {
        type: [String],
        default: [],
      },
      currentMedications: {
        type: [String],
        default: [],
      },
      allergies: {
        type: [String],
        default: [],
      },
      preferredLanguage: {
        type: String,
        trim: true,
        maxlength: 60,
        default: "",
      },
      specialAssistance: {
        type: String,
        trim: true,
        maxlength: 200,
        default: "",
      },
      emergencyContact: {
        name: { type: String, trim: true, maxlength: 100, default: "" },
        phone: { type: String, trim: true, maxlength: 20, default: "" },
      },
      insuranceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Insurance",
      },
      reportIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "MedicalReport",
        default: [],
      },

      // Phase DOC-04 — additive reschedule audit trail. Optional/defaulted
      // so every existing Appointment document and every existing consumer
      // keeps working unmodified; date/timeSlot remain the live, current
      // values (unchanged meaning), this only records history of changes.
      rescheduleHistory: {
        type: [
          {
            fromDate: Date,
            fromTimeSlot: String,
            toDate: Date,
            toTimeSlot: String,
            rescheduledBy: { type: String, enum: ["patient", "doctor", "admin"] },
            reason: { type: String, trim: true, maxlength: 300, default: "" },
            at: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },

      // Phase DOC-07 final pass — additive-only. Every pre-existing
      // Appointment document defaults to ("patient", "consultation"), which
      // is exactly what it always implicitly meant, so no backfill/migration
      // is needed and no existing consumer's meaning changes. These exist so
      // the real follow-up scheduling flow (doctor books directly from a
      // patient's follow-up queue) can be told apart from a patient's own
      // booking wherever that distinction is useful (Doctor Appointments
      // list, analytics), without a second Appointment-like model.
      bookedBy: {
        type: String,
        enum: ["patient", "doctor", "admin"],
        default: "patient",
      },
      appointmentType: {
        type: String,
        enum: ["consultation", "follow_up"],
        default: "consultation",
      },
      // Phase 16 — server-recorded acknowledgement for the booking disclosure.
      legalConsent: {
        acceptedAt: Date,
        termsVersion: String,
        privacyPolicyVersion: String,
        medicalDisclaimerVersion: String,
      },
      // P22: durable lifecycle history on the canonical Appointment document.
      statusHistory: {
        type: [{
          status: { type: String, enum: APPOINTMENT_STATUS_VALUES },
          fromStatus: { type: String, enum: [...APPOINTMENT_STATUS_VALUES, ""] },
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          actorRole: { type: String, enum: ["patient", "doctor", "admin", "super_admin", "system"] },
          reason: { type: String, trim: true, maxlength: 500, default: "" },
          at: { type: Date, default: Date.now },
        }],
        default: [],
      },
      bookingRequestId: { type: String, trim: true, maxlength: 100 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

appointmentSchema.index(
  { bookingRequestId: 1 },
  { unique: true, sparse: true },
);

appointmentSchema.index(
  { doctorId: 1, date: 1, timeSlot: 1 },
  {
    unique: true,
    // BUGFIX: this previously only covered PENDING/APPROVED, which meant a
    // slot became bookable again by a SECOND patient the moment the first
    // patient's appointment moved into payment (PAYMENT_PENDING) or even
    // after they'd fully paid (PAYMENT_COMPLETED, CONSULTATION_STARTED...).
    // ACTIVE_STATUSES is the full "this slot is taken" lifecycle and is the
    // same set the application-level conflict checks in
    // appointmentController.js now use — one source of truth for what
    // "taken" means.
    partialFilterExpression: {
      status: { $in: ACTIVE_STATUSES },
    },
  },
);

const Appointment = mongoose.model("Appointment", appointmentSchema);

export default Appointment;
