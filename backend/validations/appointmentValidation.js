import mongoose from "mongoose";
import { APPOINTMENT_STATUS_VALUES } from "../constants/appointmentStatus.js";

export const validateAppointmentCreate = (payload) => {
  const errors = {};

  if (!payload.doctorId || !mongoose.Types.ObjectId.isValid(payload.doctorId)) {
    errors.doctorId = "A valid doctorId is required";
  }

  if (!payload.date || Number.isNaN(Date.parse(payload.date))) {
    errors.date = "A valid appointment date is required";
  }

  if (!payload.timeSlot || typeof payload.timeSlot !== "string") {
    errors.timeSlot = "A valid time slot is required";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateAppointmentStatusUpdate = (payload) => {
  const errors = {};

  if (!payload.status || !APPOINTMENT_STATUS_VALUES.includes(payload.status)) {
    errors.status = `Status must be one of: ${APPOINTMENT_STATUS_VALUES.join(", ")}`;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};
