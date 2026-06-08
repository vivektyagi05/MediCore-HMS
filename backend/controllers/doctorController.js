import mongoose from "mongoose";
import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import { ROLES } from "../constants/roles.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { ensureDoctorProfileForUser } from "../services/doctorProfileService.js";

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const validateDoctorPayload = (payload, partial = false) => {
  const errors = {};

  if (!partial || payload.userId !== undefined) {
    if (!payload.userId || !mongoose.Types.ObjectId.isValid(payload.userId)) {
      errors.userId = "A valid userId is required";
    }
  }

  if (!partial || payload.specialization !== undefined) {
    if (!payload.specialization || payload.specialization.trim().length < 2) {
      errors.specialization = "Specialization is required";
    }
  }

  if (!partial || payload.experience !== undefined) {
    if (payload.experience === undefined || Number(payload.experience) < 0) {
      errors.experience = "Experience must be a non-negative number";
    }
  }

  if (!partial || payload.fees !== undefined) {
    if (payload.fees === undefined || Number(payload.fees) < 0) {
      errors.fees = "Fees must be a non-negative number";
    }
  }

  if (payload.availability !== undefined && !Array.isArray(payload.availability)) {
    errors.availability = "Availability must be an array of day/time slot objects";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const getDoctors = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};

  if (req.query.specialization) {
    filter.specialization = new RegExp(req.query.specialization, "i");
  }

  if (
    req.user &&
    req.user.role === ROLES.PATIENT
  ) {
    filter.isVerified = true;
    filter.verificationStatus = "approved";
  }

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .populate("userId", "name email role isActive")
      .sort({ rating: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Doctor.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      doctors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
    message: "Doctors fetched successfully",
  });
});

export const createDoctor = asyncHandler(async (req, res) => {
  const validation = validateDoctorPayload(req.body);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const user = await User.findById(req.body.userId);

  if (!user || !user.isActive) {
    throw new AppError("Doctor user account was not found", 404);
  }

  if (user.role !== ROLES.DOCTOR) {
    throw new AppError("Only users with doctor role can have a doctor profile", 400);
  }

  const doctor = await ensureDoctorProfileForUser(user, {
    specialization: req.body.specialization,
    experience: req.body.experience,
    fees: req.body.fees,
    availability: req.body.availability || [],
    rating: req.body.rating || 0,
  });

  doctor.specialization = req.body.specialization.trim();
  doctor.experience = Number(req.body.experience);
  doctor.fees = Number(req.body.fees);
  doctor.availability = req.body.availability || [];
  doctor.rating = req.body.rating || doctor.rating || 0;
  await doctor.save();

  const populatedDoctor = await doctor.populate("userId", "name email role isActive");

  res.status(201).json({
    success: true,
    data: populatedDoctor,
    message: "Doctor profile created successfully",
  });
});

export const updateDoctor = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor id", 400);
  }

  const validation = validateDoctorPayload(req.body, true);

  if (!validation.isValid) {
    throw new AppError("Validation failed", 400, validation.errors);
  }

  const allowedUpdates = [
    "specialization",
    "experience",
    "fees",
    "availability",
    "rating",
  ];

  const updates = {};
  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const doctor = await Doctor.findByIdAndUpdate(req.params.id, updates, {
    returnDocument: "after",
    runValidators: true,
  }).populate("userId", "name email role isActive");

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  res.status(200).json({
    success: true,
    data: doctor,
    message: "Doctor profile updated successfully",
  });
});

export const deleteDoctor = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new AppError("Invalid doctor id", 400);
  }

  const doctor = await Doctor.findByIdAndDelete(req.params.id);

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  res.status(200).json({
    success: true,
    data: { id: req.params.id },
    message: "Doctor profile deleted successfully",
  });
});

export const getDoctorPatients = asyncHandler(async (req, res) => {
  const doctor = await ensureDoctorProfileForUser(req.user);

  const appointments = await Appointment.find({
    doctorId: doctor._id,
  })
    .populate(
      "patientId",
      `
        name
        email
        patientProfile
      `,
    )
    .sort({ date: -1 })
    .lean();

  

  const patientMap = new Map();

  appointments.forEach((appointment) => {
    const patient = appointment.patientId;

    if (!patient?._id) return;

    const patientId = patient._id.toString();

    if (!patientMap.has(patientId)) {
      patientMap.set(patientId, {
        _id: patient._id,
        name: patient.name,
        email: patient.email,

        gender:
          patient.patientProfile?.gender || "",

        bloodGroup:
          patient.patientProfile?.bloodGroup || "",

        appointmentCount: 1,

        lastVisit: appointment.date,

        needsFollowUp: false,
      });
    } else {
      const existing = patientMap.get(patientId);

      existing.appointmentCount += 1;

      if (
        new Date(appointment.date) >
        new Date(existing.lastVisit)
      ) {
        existing.lastVisit = appointment.date;
      }
    }
  });

  

  const patients = Array.from(
    patientMap.values(),
  ).map((patient) => {
    const daysSinceVisit = Math.floor(
      (Date.now() -
        new Date(patient.lastVisit).getTime()) /
        (1000 * 60 * 60 * 24),
    );

    return {
      ...patient,
      needsFollowUp: daysSinceVisit > 30,
    };
  });

  const analytics = {
    totalPatients: patients.length,

    activePatients: patients.filter(
      (p) => !p.needsFollowUp,
    ).length,

    followUps: patients.filter(
      (p) => p.needsFollowUp,
    ).length,

    newPatientsThisMonth: patients.filter((p) => {
      const visitDate = new Date(p.lastVisit);

      const now = new Date();

      return (
        visitDate.getMonth() === now.getMonth() &&
        visitDate.getFullYear() ===
          now.getFullYear()
      );
    }).length,
  };

  res.status(200).json({
    success: true,
    data: {
      analytics,
      patients,
    },
    message:
      "Doctor patients fetched successfully",
  });
});

export const getPendingDoctors = asyncHandler(
  async (_req, res) => {

    const doctors =
      await Doctor.find({
        verificationStatus: "pending",
      })
      .populate(
        "userId",
        "name email doctorOnboardingStatus"
      )
      .sort({
        createdAt: -1,
      });

    res.status(200).json({
      success: true,
      data: doctors,
    });
  }
);

export const approveDoctor = asyncHandler(
  async (req, res) => {

    const doctor =
      await Doctor.findById(
        req.params.id
      );

    if (!doctor) {
      throw new AppError(
        "Doctor not found",
        404
      );
    }

    doctor.verificationStatus =
      "approved";

    doctor.isVerified = true;

    doctor.verifiedBy =
      req.user._id;

    doctor.verifiedAt =
      new Date();

    await doctor.save();

    await User.findByIdAndUpdate(
      doctor.userId,
      {
        doctorOnboardingStatus:
          "approved",
      }
    );

    res.status(200).json({
      success: true,
      message:
        "Doctor approved successfully",
    });
  }
);

export const rejectDoctor = asyncHandler(
  async (req, res) => {

    const doctor =
      await Doctor.findById(
        req.params.id
      );

    if (!doctor) {
      throw new AppError(
        "Doctor not found",
        404
      );
    }

    doctor.verificationStatus =
      "rejected";

    doctor.isVerified = false;

    doctor.verificationNotes =
      req.body.reason || "";

    doctor.verifiedBy =
      req.user._id;

    doctor.verifiedAt =
      new Date();

    await doctor.save();

    await User.findByIdAndUpdate(
      doctor.userId,
      {
        doctorOnboardingStatus:
          "rejected",
      }
    );

    res.status(200).json({
      success: true,
      message:
        "Doctor rejected successfully",
    });
  }
);