import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Doctor from "../models/Doctor.js";
import FamilyMember from "../models/FamilyMember.js";
import { APPOINTMENT_STATUS, PAYMENT_STATUS,STATUS_TRANSITIONS } from "../constants/appointmentStatus.js";
import { ADMIN_ROLES, ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { emailService } from "../services/emailService.js";
import { appointmentEmitter } from "../realtime/appointmentEmitter.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";
import {
  validateAppointmentCreate,
  validateAppointmentStatusUpdate,
} from "../validations/appointmentValidation.js";
import LeaveRequest from "../models/LeaveRequest.js";
import Payment from "../models/Payment.js";
import RefundRequest from "../models/RefundRequest.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const getDayOfWeek = (date) =>
  date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).toLowerCase();

const normalizeDate = (dateValue) => {
  const date = new Date(dateValue);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const ensureDoctorAvailable = (
  doctor,
  date,
  timeSlot
) => {

  const dayOfWeek =
    getDayOfWeek(date);

  const dayAvailability =
    doctor.availability.find(
      (slot) =>
        slot.dayOfWeek ===
        dayOfWeek
    );

  if (
    !dayAvailability ||
    !dayAvailability.timeSlots.includes(
      timeSlot
    )
  ) {
    throw new AppError(
      "Doctor is not available on this day/time",
      409
    );
  }

  const blockedDate =
    doctor.blockedDates?.find(
      (item) =>
        new Date(item.date)
          .toDateString() ===
        date.toDateString()
    );

  if (blockedDate) {
    throw new AppError(
      blockedDate.reason ||
      "Doctor is unavailable on selected date",
      409
    );
  }

  const isBlocked =
    doctor.blockedDates?.some(
      (blocked) => {

        const blockedDate =
          new Date(blocked.date);

        blockedDate.setUTCHours(
          0,
          0,
          0,
          0
        );

        return (
          blockedDate.getTime() ===
          date.getTime()
        );
      }
    );

  if (isBlocked) {
    throw new AppError(
      "Doctor is unavailable on this date",
      409
    );
  }
};

const buildRoleBasedFilter = async (req) => {
  if (ADMIN_ROLES.includes(req.user.role)) return {};

  if (req.user.role === ROLES.PATIENT) {
    return { patientId: req.user._id };
  }

  if (req.user.role === ROLES.DOCTOR) {
    const doctor = await ensureDoctorProfileForUser(req.user);

    return { doctorId: doctor._id };
  }

  throw new AppError("Unsupported appointment access role", 403);
};

export const createAppointment = asyncHandler(async (req, res) => {
  const validation = validateAppointmentCreate(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const doctor = await Doctor.findById(req.body.doctorId).lean();

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  

  if (
    !doctor.isVerified ||
    doctor.verificationStatus !== "approved"
  ) {
    throw new AppError(
      "Doctor is not approved for appointments",
      403
    );
  }

  const appointmentDate = normalizeDate(req.body.date);
  const today = new Date();

  today.setUTCHours(
    0,
    0,
    0,
    0
  );

  if (
    appointmentDate < today
  ) {
    throw new AppError(
      "Past appointments are not allowed",
      400
    );
  }
  ensureDoctorAvailable(doctor, appointmentDate, req.body.timeSlot);

  const activeLeave =
  await LeaveRequest.findOne({
    doctorId: doctor._id,
    status: "approved",
    startDate: {
      $lte: appointmentDate,
    },
    endDate: {
      $gte: appointmentDate,
    },
  });

if (activeLeave) {
  throw new AppError(
    "Doctor is on leave",
    409
  );
}

  const existingAppointment = await Appointment.findOne({
    doctorId: doctor._id,
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    status: { $in: [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED] },
  }).lean();

  if (existingAppointment) {
    throw new AppError("This doctor is already booked for the selected slot", 409);
  }

  let familyMemberId;
  if (req.body.familyMemberId) {
    const familyMember = await FamilyMember.findOne({
      _id: req.body.familyMemberId,
      userId: req.user._id,
      isActive: true,
    }).lean();
    if (!familyMember) {
      throw new AppError("Family member was not found for this patient account", 403);
    }
    familyMemberId = familyMember._id;
  }

  const duplicateBooking =
    await Appointment.findOne({
      patientId: req.user._id,
      doctorId: doctor._id,
      date: appointmentDate,

      status: {
        $in: [
          APPOINTMENT_STATUS.PENDING,
          APPOINTMENT_STATUS.APPROVED,
        ],
      },
    });

  if (duplicateBooking) {
    throw new AppError(
      "You already have an appointment with this doctor on this date",
      409
    );
  }

  const appointment = await Appointment.create({
    patientId: req.user._id,
    familyMemberId,
    doctorId: doctor._id,
    date: appointmentDate,
    timeSlot: req.body.timeSlot,
    notes: req.body.notes || "",
  });

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    {
      path: "doctorId",
      select: "specialization fees rating userId",
      populate: { path: "userId", select: "name email role" },
    },
  ]);

  await appointmentEmitter.created(populatedAppointment);
  appointmentEmitter.slotUnavailable(doctor._id, appointmentDate, req.body.timeSlot);

  res.status(201).json({
    success: true,
    data: populatedAppointment,
    message: "Appointment created successfully",
  });
});

export const getAppointments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = await buildRoleBasedFilter(req);

  if (req.query.status) filter.status = req.query.status;

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .populate("patientId", "name email role")
      .populate({
        path: "doctorId",
        select: "specialization fees rating userId",
        populate: { path: "userId", select: "name email role" },
      })
      .sort({ date: 1, timeSlot: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      appointments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
    message: "Appointments fetched successfully",
  });
});

export const updateAppointmentStatus = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid appointment id", 400);
  }

  const validation = validateAppointmentStatusUpdate(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const appointment = await Appointment.findById(req.params.id).populate(
    "doctorId",
    "userId",
  );

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  if (
    req.user.role === ROLES.DOCTOR &&
    appointment.doctorId.userId.toString() !== req.user._id.toString()
  ) {
    throw new AppError("Doctors can only update their own appointments", 403);
  }

  const allowedTransitions = STATUS_TRANSITIONS[appointment.status] || [];




if (
  req.body.status ===
    APPOINTMENT_STATUS.COMPLETED &&

  appointment.paymentStatus !==
    "paid"
) {

  throw new AppError(
    "Appointment payment is pending",
    400
  );
}

  if (!allowedTransitions.includes(req.body.status)) {
    throw new AppError(
      `Cannot transition appointment from ${appointment.status} to ${req.body.status}`,
      400,
    );
  }

  appointment.status = req.body.status;
  if (req.body.notes !== undefined) appointment.notes = req.body.notes;

  await appointment.save();

  const populatedAppointment = await appointment.populate([
    { path: "patientId", select: "name email role" },
    {
      path: "doctorId",
      select: "specialization fees rating userId",
      populate: { path: "userId", select: "name email role" },
    },
  ]);

  if (req.body.status === APPOINTMENT_STATUS.APPROVED) {
    await emailService.sendAppointmentConfirmation({
      patient: populatedAppointment.patientId,
      appointment: populatedAppointment,
    });
  }

  await appointmentEmitter.statusUpdated(populatedAppointment);

  res.status(200).json({
    success: true,
    data: populatedAppointment,
    message: "Appointment status updated successfully",
  });
});


export const cancelAppointment = asyncHandler(async (req, res) => {

  const appointment =
    await Appointment.findById(
      req.params.id
    );

  if (!appointment) {
    throw new AppError(
      "Appointment not found",
      404
    );
  }

  if (
    appointment.patientId.toString() !==
    req.user._id.toString()
  ) {
    throw new AppError(
      "You can only cancel your own appointment",
      403
    );
  }

  if (
    appointment.status ===
      APPOINTMENT_STATUS.COMPLETED ||

    appointment.status ===
      APPOINTMENT_STATUS.CANCELLED
  ) {
    throw new AppError(
      "Appointment cannot be cancelled",
      400
    );
  }

  appointment.status =
  APPOINTMENT_STATUS.CANCELLED;

appointment.notes =
  req.body.reason ||
  "Cancelled by patient";

await appointment.save();

if (
  appointment.paymentStatus ===
  PAYMENT_STATUS.PAID
) {

  const payment =
    await Payment.findOne({
      appointmentId:
        appointment._id,
    });

  if (payment) {

    await RefundRequest.create({
      paymentId:
        payment._id,

      userId:
        appointment.patientId,

      amount:
        payment.totalAmount,

      reason:
        "Appointment cancelled by patient",

      status:
        "pending",
    });
  }
}

res.status(200).json({
  success: true,
  data: appointment,
  message:
    "Appointment cancelled successfully",
});
});
