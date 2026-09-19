// Practice Management Platform realtime events (Phase D4, Step 8).
//
// Before this phase, none of doctor approval/rejection, subscription
// create/cancel/renewal, invoice generation, or profile-completion changes
// emitted anything -- a doctor waiting on verification or a lapsed
// subscription had no realtime signal at all. This follows the exact same
// notificationEmitter + roomManager pattern already used by
// clinicalEmitter.js so it's consistent with the rest of the codebase.
import { notificationEmitter } from "./notificationEmitter.js";
import { roomManager } from "../socket/roomManager.js";
import { getIO } from "../socket/socketServer.js";

import { buildVerificationEventKey } from "../utils/verificationCycle.js";

export const practiceEmitter = {
  async verificationStatusChanged({ doctorUserId, doctorId, cycleId, status, notes }) {
    const titles = {
      approved: "Your verification was approved",
      rejected: "Your verification was rejected",
      pending: "Your verification is pending review",
    };
    await notificationEmitter.emitToUser(doctorUserId, {
      type: "doctor_verification",
      title: titles[status] || "Verification status updated",
      message: notes || `Your verification status is now "${status}".`,
      entityType: "Doctor",
      entityId: doctorId,
      severity: status === "rejected" ? "warning" : "info",
      eventKey: buildVerificationEventKey({ doctorId, cycleId: cycleId?.toString(), status }),
    });
    getIO()?.to(roomManager.userRoom(doctorUserId)).emit("practice:verification-updated", {
      doctorId,
      status,
      at: new Date(),
    });
  },

  async subscriptionUpdated({ doctorUserId, subscriptionId, status, planName }) {
    await notificationEmitter.emitToUser(doctorUserId, {
      type: "subscription_update",
      title: "Subscription updated",
      message: `Your ${planName || "subscription"} is now "${status}".`,
      entityType: "Subscription",
      entityId: subscriptionId,
      severity: status === "past_due" || status === "cancelled" ? "warning" : "info",
      eventKey: `subscription:${subscriptionId}:${status}`,
    });
    getIO()?.to(roomManager.userRoom(doctorUserId)).emit("practice:subscription-updated", {
      subscriptionId,
      status,
      at: new Date(),
    });
  },

  async invoiceGenerated({ doctorUserId, invoiceId, totalAmount, currency }) {
    await notificationEmitter.emitToUser(doctorUserId, {
      type: "invoice_generated",
      title: "New invoice generated",
      message: `A new invoice for ${currency || "INR"} ${totalAmount} is ready.`,
      entityType: "Invoice",
      entityId: invoiceId,
      severity: "info",
      eventKey: `invoice:${invoiceId}`,
    });
    getIO()?.to(roomManager.userRoom(doctorUserId)).emit("practice:invoice-generated", {
      invoiceId,
      at: new Date(),
    });
  },

  async renewalReminder({ doctorUserId, subscriptionId, planName, daysRemaining, nextBillingAt }) {
    await notificationEmitter.emitToUser(doctorUserId, {
      type: "subscription_renewal_reminder",
      title: "Subscription renewal coming up",
      message: `Your ${planName} renews in ${daysRemaining} day(s), on ${new Date(nextBillingAt).toLocaleDateString()}.`,
      entityType: "Subscription",
      entityId: subscriptionId,
      severity: "info",
      eventKey: `subscription:${subscriptionId}:reminder:${daysRemaining}`,
    });
  },

  profileCompletionUpdated(doctorUserId, doctorId, completionPercent) {
    getIO()?.to(roomManager.userRoom(doctorUserId)).emit("practice:profile-completion-updated", {
      doctorId,
      completionPercent,
      at: new Date(),
    });
  },
};
