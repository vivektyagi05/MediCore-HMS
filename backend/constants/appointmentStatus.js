export const APPOINTMENT_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
};
export const APPOINTMENT_STATUS_VALUES = Object.freeze(
  Object.values(APPOINTMENT_STATUS),
);

export const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));

export const STATUS_TRANSITIONS = Object.freeze({
  [APPOINTMENT_STATUS.PENDING]: [
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.APPROVED]: [
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
});
