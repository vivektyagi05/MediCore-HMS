import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../middleware/errorMiddleware.js";

export const getMyOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  res.status(200).json({
    success: true,
    data: doctor,
  });
});

export const submitOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  Object.assign(doctor, req.body);

  doctor.verificationStatus = "pending";

  await doctor.save();

  await User.findByIdAndUpdate(req.user._id, {
    doctorOnboardingStatus: "pending",
    doctorVerification: {
      submittedAt: new Date(),
    },
  });

  res.status(200).json({
    success: true,
    message: "Onboarding submitted successfully",
  });
});

export const updateOnboarding = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({
    userId: req.user._id,
  });

  if (!doctor) {
    throw new AppError("Doctor profile not found", 404);
  }

  if (doctor.verificationStatus === "approved") {
    throw new AppError(
      "Approved profile cannot be edited",
      400
    );
  }

  Object.assign(doctor, req.body);

  await doctor.save();

  res.status(200).json({
    success: true,
    data: doctor,
  });
});