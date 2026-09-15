// Canonical public Doctor representation. Every public discovery surface should
// consume this serializer so private/admin-only fields never leak and photo
// URLs remain consistent.
export const buildDoctorProfilePhotoUrl = (profilePhoto, req) => {
  if (!profilePhoto) return null;
  const value = String(profilePhoto);
  if (/^https?:\/\//i.test(value)) return value;
  if (!req) return value.startsWith("/") ? value : `/${value}`;
  const protocol = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() || req.protocol;
  const host = req.get("host");
  return `${protocol}://${host}${value.startsWith("/") ? value : `/${value}`}`;
};

export const serializeDoctorPublicProfile = (doctor, req, metrics = {}) => {
  const totalReviews = Number.isFinite(metrics.totalReviews) ? metrics.totalReviews : 0;
  const rating = Number.isFinite(metrics.rating)
    ? Number(metrics.rating.toFixed(1))
    : Number((doctor.rating || 0).toFixed(1));

  return {
    id: doctor._id,
    name: doctor.userId?.name || "",
    specialization: doctor.specialization || "",
    qualification: doctor.qualification || "",
    experience: doctor.experience ?? null,
    fees: doctor.fees ?? null,
    city: doctor.city || "",
    state: doctor.state || "",
    district: doctor.district || "",
    location: doctor.location?.type === "Point" && Array.isArray(doctor.location.coordinates)
      ? { type: "Point", coordinates: doctor.location.coordinates }
      : null,
    hospitalName: doctor.hospitalName || "",
    bio: doctor.bio || "",
    languages: doctor.languages || [],
    consultationMode: doctor.consultationMode || [],
    availability: doctor.availability || [],
    subSpecialties: doctor.subSpecialties || [],
    education: doctor.education || [],
    experienceEntries: doctor.experienceEntries || [],
    awards: doctor.awards || [],
    researchPublications: doctor.researchPublications || [],
    memberships: doctor.memberships || [],
    clinics: (doctor.clinics || []).map((clinic) => ({
      name: clinic.name,
      address: clinic.address || "",
      city: clinic.city || "",
      state: clinic.state || "",
      district: clinic.district || "",
      location: clinic.location?.type === "Point" && Array.isArray(clinic.location.coordinates)
        ? { type: "Point", coordinates: clinic.location.coordinates }
        : null,
      phone: clinic.phone || "",
      isPrimary: Boolean(clinic.isPrimary),
    })),
    clinicPhotos: doctor.clinicPhotos || [],
    emergencyAvailability: Boolean(doctor.emergencyAvailability),
    insuranceAccepted: doctor.insuranceAccepted || [],
    rating,
    totalReviews,
    licenseNumber: doctor.licenseNumber
      ? (String(doctor.licenseNumber).length >= 4
        ? `${String(doctor.licenseNumber).slice(0, 2)}${"*".repeat(Math.max(0, String(doctor.licenseNumber).length - 4))}${String(doctor.licenseNumber).slice(-2)}`
        : "****")
      : null,
    medicalCouncil: doctor.medicalCouncil || "",
    isVerified: Boolean(doctor.isVerified && doctor.verificationStatus === "approved"),
    verificationStatus: doctor.verificationStatus || "pending",
    verifiedAt: doctor.verifiedAt || null,
    verificationHistory: (doctor.verificationHistory || []).map((item) => ({
      status: item.status,
      changedAt: item.changedAt,
    })),
    profilePhoto: buildDoctorProfilePhotoUrl(doctor.profilePhoto, req),
    createdAt: doctor.createdAt || null,
  };
};
