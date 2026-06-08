import Doctor from "../models/Doctor.js";
import User from "../models/User.js";
import { ROLES } from "../constants/roles.js";
import { AppError } from "../middleware/errorMiddleware.js";

export const DEFAULT_DOCTOR_PROFILE = Object.freeze({
  specialization: "General Medicine",
  experience: 0,
  fees: 0,
  availability: [],
  rating: 0,
});

const normalizeUserId = (userOrId) => userOrId?._id || userOrId;

export const doctorProfileDefaults = (overrides = {}) => ({
  specialization: overrides.specialization?.trim() || DEFAULT_DOCTOR_PROFILE.specialization,
  experience: Number(overrides.experience ?? DEFAULT_DOCTOR_PROFILE.experience),
  fees: Number(overrides.fees ?? DEFAULT_DOCTOR_PROFILE.fees),
  availability: Array.isArray(overrides.availability)
    ? overrides.availability
    : DEFAULT_DOCTOR_PROFILE.availability,
  rating: Number(overrides.rating ?? DEFAULT_DOCTOR_PROFILE.rating),
});

export const ensureDoctorProfileForUser = async (userOrId, overrides = {}) => {
  const userId = normalizeUserId(userOrId);

  if (!userId) {
    throw new AppError("Doctor user id is required", 400);
  }

  const user = userOrId?.role
    ? userOrId
    : await User.findById(userId).select("_id role isActive").lean();

  if (!user || !user.isActive) {
    throw new AppError("Doctor user account was not found", 404);
  }

  if (user.role !== ROLES.DOCTOR) {
    throw new AppError("Only users with doctor role can have a doctor profile", 400);
  }

  return Doctor.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        ...doctorProfileDefaults(overrides),
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );
};

export const repairMissingDoctorProfiles = async () => {
  const doctorUsers = await User.find({
    role: ROLES.DOCTOR,
    isActive: true,
  })
    .select("_id role isActive")
    .lean();

  const repaired = [];

  for (const user of doctorUsers) {
    const existingProfile = await Doctor.findOne({ userId: user._id }).select("_id").lean();

    if (!existingProfile) {
      const profile = await ensureDoctorProfileForUser(user);
      repaired.push(profile);
    }
  }

  return {
    checked: doctorUsers.length,
    repaired: repaired.length,
    doctorProfileIds: repaired.map((profile) => profile._id),
  };
};
