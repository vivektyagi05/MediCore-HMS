// PHASE UI-3 — Appointment Operations Workspace.
//
// Extracted from appointmentController.cancelAppointment so the admin
// cancellation path (new in this phase) shares the EXACT same rules —
// which statuses are cancellable, the auto-refund-request creation, the
// doctor notification, and the automation trigger — instead of a second,
// independently-maintained copy drifting out of sync with the first.
import { AppError } from "../middleware/errorMiddleware.js";
import {
  APPOINTMENT_STATUS,
  CANCELLABLE_STATUSES,
  PAYMENT_STATUS,
} from "../constants/appointmentStatus.js";
import Payment from "../models/Payment.js";
import Prescription from "../models/Prescription.js";
import RefundRequest from "../models/RefundRequest.js";
import { appointmentEmitter } from "../realtime/appointmentEmitter.js";
import { notificationEmitter } from "../realtime/notificationEmitter.js";
import { emitAutomationTrigger } from "../automation-studio/automationEventBus.js";
import { TRIGGER_TYPES } from "../automation-studio/triggerRegistry.js";
import { logger } from "../utils/logger.js";
import { appendAppointmentHistory } from "./appointmentHistoryService.js";

// Throws an AppError with a message that explains WHY, per the mission's
// "error handling is a product feature" rule — never a bare "cannot cancel".
export const assertAppointmentCancellable = (appointment) => {
  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError("Appointment is already cancelled", 409);
  }
  if (!CANCELLABLE_STATUSES.includes(appointment.status)) {
    throw new AppError(
      `Appointment cannot be cancelled — current status is "${appointment.status}". ` +
        "Only appointments that have not yet started consultation can be cancelled.",
      400,
    );
  }
};

// Returns { appointment, refundRequestCreated }. Caller is responsible for
// the ownership/permission check appropriate to who is cancelling — this
// function only knows about the appointment-state rules and the real
// downstream effects (refund request, notification, automation trigger),
// which must be identical no matter who triggers them.
export const cancelAppointmentCore = async ({ appointment, reason, cancelledBy, actorId }) => {
  assertAppointmentCancellable(appointment);

  const previousStatus = appointment.status;
  appointment.status = APPOINTMENT_STATUS.CANCELLED;
  appointment.cancelReason = reason || `Cancelled by ${cancelledBy}`;
  appendAppointmentHistory({ appointment, status: APPOINTMENT_STATUS.CANCELLED, fromStatus: previousStatus, actorId, actorRole: cancelledBy, reason: appointment.cancelReason });
  await appointment.save();

  // PHASE P10 (Follow-up/Continuity) — the real bug this phase exists to
  // fix: cancelling a follow-up appointment used to leave
  // Prescription.followUpScheduledAppointmentId pointing at a now-cancelled
  // appointment forever. Every follow-up surface (Dashboard queue, Patient
  // Profile, attention items) excludes any prescription with that field
  // set — so the original clinical recommendation would silently vanish
  // with no trace and no path back into the doctor's queue. Clearing the
  // link puts the prescription straight back into the normal
  // overdue/due-today/upcoming derivation (resolveFollowUpState), and
  // followUpCancelledAt records the real fact that it was scheduled once
  // and then cancelled, so the doctor sees why, not just a bare
  // recommendation that looks like it was never acted on.
  //
  // Ordering and failure-mode analysis (no multi-document transactions are
  // available — this project's `mongo:7` deployment is standalone, not a
  // replica set; see docker-compose.yml — so these two document writes
  // cannot be made atomic together):
  //
  //   1. Appointment.save() (above) MUST happen first. If the unlink were
  //      attempted first and then appointment.save() failed, the
  //      prescription would look "unscheduled" while a real, still-ACTIVE
  //      appointment silently continues to exist — and a doctor rescheduling
  //      in that gap would create a genuine second active appointment,
  //      recreating exactly the duplicate-follow-up bug. Cancelling first
  //      means the worst case if the unlink below fails is the opposite,
  //      strictly safer shape: a prescription still pointing at an
  //      appointment that IS genuinely cancelled — never two live ones.
  //   2. If every retry below still fails, this is not a silent loss:
  //      resolveScheduledFollowUps() (doctorPatientRelationshipService.js)
  //      classifies exactly this state — a linked appointment whose status
  //      is "cancelled" — as `cancelled_needs_action`, which is exactly as
  //      visible to the doctor (Dashboard queue, attention items, Open
  //      Clinical Actions) as if this update had succeeded immediately.
  //      And scheduleFollowUpAppointment's own self-heal step clears a
  //      stale link exactly like this the next time anyone tries to
  //      reschedule it. So the write below is a best-effort *latency*
  //      optimization for how quickly the doctor sees "recommended again"
  //      rather than "cancelled_needs_action" — never the only mechanism
  //      the correctness of the continuity loop depends on.
  if (appointment.appointmentType === "follow_up") {
    const unlinkUpdate = { $unset: { followUpScheduledAppointmentId: "" }, $set: { followUpCancelledAt: new Date() } };
    const maxAttempts = 3;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await Prescription.updateOne({ followUpScheduledAppointmentId: appointment._id }, unlinkUpdate);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 75));
      }
    }
    if (lastError) {
      logger.error("Failed to unlink cancelled follow-up appointment from its prescription after retries", {
        message: lastError?.message,
        appointmentId: appointment._id,
        attempts: maxAttempts,
      });
    }
  }

  let refundRequestCreated = false;

  // Auto-create refund request if payment was already made — identical to
  // the patient path's existing behavior, now shared rather than
  // duplicated for the admin path.
  if (appointment.paymentStatus === PAYMENT_STATUS.PAID) {
    try {
      const payment = await Payment.findOne({ appointmentId: appointment._id });
      if (payment) {
        const existingRefund = await RefundRequest.findOne({ paymentId: payment._id });
        if (!existingRefund) {
          await RefundRequest.create({
            paymentId: payment._id,
            requestedBy: actorId,
            amount: payment.totalAmount,
            reason: reason || `Appointment cancelled by ${cancelledBy}`,
            status: "pending",
            timeline: [
              {
                status: "pending",
                note: `Auto refund request created on appointment cancellation (cancelled by ${cancelledBy})`,
                actorId,
              },
            ],
          });
          refundRequestCreated = true;
        }
      }
    } catch (error) {
      logger.error("Auto refund-request creation failed on appointment cancellation", {
        message: error?.message,
        appointmentId: appointment._id,
      });
    }
  }

  // BUGFIX (Phase P4 audit): this used to be an if/else — "notify the
  // patient" OR "notify the doctor", never both. That's correct for the two
  // cases it was written for (patient cancels -> tell doctor; doctor
  // cancels -> tell patient), but admin cancellation also sets
  // cancelledBy="admin" (see appointmentAdminController.js), which fell into
  // the `!== "patient"` branch and notified ONLY the patient — the doctor
  // was never told their own appointment had been cancelled by the clinic.
  // Cross-role consistency (brief §16) requires the doctor to always know.
  // Rule now: notify each side unless THEY were the one who cancelled.
  if (cancelledBy !== "patient") {
    try {
      const populated = await appointment.populate("patientId", "_id name");
      if (populated?.patientId?._id) {
        await notificationEmitter.emitToUser(populated.patientId._id, {
          type: "appointment",
          title: appointment.appointmentType === "follow_up" ? "Follow-up appointment cancelled" : "Appointment cancelled",
          message:
            appointment.appointmentType === "follow_up"
              ? `Your follow-up appointment on ${new Date(appointment.date).toDateString()} at ${appointment.timeSlot} was cancelled. Reason: ${appointment.cancelReason}. Your doctor will need to reschedule your follow-up.`
              : `Your appointment on ${new Date(appointment.date).toDateString()} at ${appointment.timeSlot} was cancelled by the clinic. Reason: ${appointment.cancelReason}`,
          entityType: "appointment",
          entityId: appointment._id,
          severity: "warning",
          eventKey: `appointment:${appointment._id}:cancelled:admin`,
        });
      }
    } catch (error) {
      logger.warn("Patient cancellation notification failed", {
        message: error?.message,
        appointmentId: appointment._id,
      });
    }
  }

  if (cancelledBy !== "doctor") {
    try {
      const populated = await appointment.populate({
        path: "doctorId",
        populate: { path: "userId", select: "_id name" },
      });
      if (populated?.doctorId?.userId?._id) {
        const isFollowUp = appointment.appointmentType === "follow_up";
        await notificationEmitter.emitToUser(populated.doctorId.userId._id, {
          type: "appointment",
          title: isFollowUp ? "Follow-up appointment cancelled" : "Appointment cancelled",
          message:
            cancelledBy === "patient"
              ? `${isFollowUp ? "Follow-up appointment" : "Appointment"} on ${new Date(appointment.date).toDateString()} at ${appointment.timeSlot} was cancelled by the patient.${isFollowUp ? " The original follow-up recommendation is back in your Follow-up Queue." : ""}`
              : `Appointment on ${new Date(appointment.date).toDateString()} at ${appointment.timeSlot} was cancelled by the clinic. Reason: ${appointment.cancelReason}`,
          entityType: "appointment",
          entityId: appointment._id,
          severity: "warning",
          eventKey: `appointment:${appointment._id}:cancelled`,
        });
      }
    } catch (error) {
      logger.warn("Doctor cancellation notification failed", {
        message: error?.message,
        appointmentId: appointment._id,
      });
    }
  }

  try {
    await appointmentEmitter.statusUpdated(
      await appointment.populate([
        { path: "patientId", select: "name email role" },
        { path: "doctorId", select: "userId" },
      ]),
    );
  } catch (error) {
    logger.warn("appointmentEmitter.statusUpdated failed on cancellation", {
      message: error?.message,
      appointmentId: appointment._id,
    });
  }

  await emitAutomationTrigger(TRIGGER_TYPES.APPOINTMENT_CANCELLED, {
    appointmentId: appointment._id,
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    date: appointment.date,
    cancelledBy,
  });

  return { appointment, refundRequestCreated };
};
