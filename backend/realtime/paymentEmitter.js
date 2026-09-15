import { notificationEmitter } from "./notificationEmitter.js";
import { getIO } from "../socket/socketServer.js";
import { roomManager } from "../socket/roomManager.js";

export const paymentEmitter = {
  async captured({ payment, invoice }) {
    const payload = {
      paymentId: payment._id,
      appointmentId: payment.appointmentId,
      invoiceId: invoice?._id,
      status: payment.status,
      totalAmount: payment.totalAmount,
      currency: payment.currency,
    };

    getIO()?.to(roomManager.patientRoom(payment.userId)).to(roomManager.adminRoom()).emit("payment:captured", payload);

    await Promise.all([
      notificationEmitter.emitToUser(payment.userId, {
        type: "payment",
        title: "Payment successful",
        message: `${payment.currency} ${payment.totalAmount} payment was captured successfully`,
        entityType: "payment",
        entityId: payment._id,
        eventKey: `payment:${payment._id}:captured`,
        severity: "success",
        metadata: { invoiceId: invoice?._id },
      }),
      notificationEmitter.emitToAdmins({
        type: "dashboard_sync",
        title: "Payment captured",
        message: `${payment.currency} ${payment.totalAmount} payment captured`,
        entityType: "payment",
        entityId: payment._id,
        eventKey: `payment:${payment._id}:admin`,
        severity: "success",
      }),
    ]);
  },

  async refundProcessed({ payment, refundRequest }) {
    const payload = {
      paymentId: payment._id,
      refundRequestId: refundRequest?._id,
      refundedAmount: payment.refundedAmount,
      refundStatus: payment.refundStatus,
    };

    getIO()?.to(roomManager.patientRoom(payment.userId._id || payment.userId)).to(roomManager.adminRoom()).emit("payment:refund", payload);

    await notificationEmitter.emitToUser(payment.userId._id || payment.userId, {
      type: "refund",
      title: "Refund processed",
      message: `Refund status is now ${payment.refundStatus}`,
      entityType: "payment",
      entityId: payment._id,
      eventKey: `refund:${refundRequest?._id || payment._id}:${payment.refundedAmount}`,
      severity: "success",
      metadata: { refundRequestId: refundRequest?._id },
    });
  },
};
