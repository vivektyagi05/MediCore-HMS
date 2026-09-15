import mongoose from "mongoose";
import { APPOINTMENT_STATUS_VALUES } from "../constants/appointmentStatus.js";
import { APPOINTMENT_CONSULTATION_MODES } from "../constants/consultationMode.js";

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

  // ── Appointment Journey — optional visit-intake fields ──
  // Every one of these is optional; validation only runs when the field is
  // actually present, so existing/simpler callers (e.g. admin tools, tests)
  // that only send doctorId/date/timeSlot are entirely unaffected.
  // NOTE: this validates the CANONICAL Appointment-side value. Callers that
  // accept a raw Doctor-side value from the client (e.g. createAppointment)
  // must canonicalize it via canonicalizeConsultationMode() BEFORE calling
  // this — see backend/constants/consultationMode.js for the full contract.
  if (payload.consultationMode !== undefined && payload.consultationMode !== "" &&
      !APPOINTMENT_CONSULTATION_MODES.includes(payload.consultationMode)) {
    errors.consultationMode = `Consultation mode must be one of: ${APPOINTMENT_CONSULTATION_MODES.join(", ")}`;
  }

  if (payload.reason !== undefined && String(payload.reason).length > 300) {
    errors.reason = "Reason must be 300 characters or fewer";
  }

  if (payload.symptoms !== undefined && !Array.isArray(payload.symptoms)) {
    errors.symptoms = "Symptoms must be a list";
  }

  if (payload.painLevel !== undefined && payload.painLevel !== null && payload.painLevel !== "") {
    const pain = Number(payload.painLevel);
    if (Number.isNaN(pain) || pain < 0 || pain > 10) {
      errors.painLevel = "Pain level must be a number between 0 and 10";
    }
  }

  if (payload.existingConditions !== undefined && !Array.isArray(payload.existingConditions)) {
    errors.existingConditions = "Existing conditions must be a list";
  }

  if (payload.currentMedications !== undefined && !Array.isArray(payload.currentMedications)) {
    errors.currentMedications = "Current medications must be a list";
  }

  if (payload.allergies !== undefined && !Array.isArray(payload.allergies)) {
    errors.allergies = "Allergies must be a list";
  }

  if (payload.specialAssistance !== undefined && String(payload.specialAssistance).length > 200) {
    errors.specialAssistance = "Special assistance notes must be 200 characters or fewer";
  }

  if (payload.emergencyContact !== undefined && payload.emergencyContact !== null) {
    if (typeof payload.emergencyContact !== "object" || Array.isArray(payload.emergencyContact)) {
      errors.emergencyContact = "Emergency contact must be an object with name and phone";
    }
  }

  if (payload.insuranceId !== undefined && payload.insuranceId !== "" && payload.insuranceId !== null &&
      !mongoose.Types.ObjectId.isValid(payload.insuranceId)) {
    errors.insuranceId = "Invalid insurance id";
  }

  if (payload.reportIds !== undefined) {
    if (!Array.isArray(payload.reportIds)) {
      errors.reportIds = "Report ids must be a list";
    } else if (payload.reportIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      errors.reportIds = "One or more report ids are invalid";
    }
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
