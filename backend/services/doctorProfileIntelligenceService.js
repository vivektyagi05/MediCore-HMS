// P18.1 — Doctor Profile Intelligence.
// Pure deterministic profile-quality rules. It owns scoring/attention semantics;
// controllers only supply the canonical Doctor record and reputation score.
const text = (value) => typeof value === "string" ? value.trim() : "";
const hasItems = (value) => Array.isArray(value) && value.length > 0;

const CHECKS = [
  { field: "bio", label: "Biography", weight: 10, done: (d) => text(d.bio).length >= 100, action: "/doctor/profile/edit", actionLabel: "Write a stronger biography" },
  { field: "profilePhoto", label: "Profile photo", weight: 8, done: (d) => Boolean(d.profilePhoto), action: "/doctor/profile/edit", actionLabel: "Add a professional profile photo" },
  { field: "qualification", label: "Qualification", weight: 8, done: (d) => Boolean(text(d.qualification)), action: "/doctor/profile/edit", actionLabel: "Add your qualification" },
  { field: "hospitalName", label: "Primary practice", weight: 8, done: (d) => Boolean(text(d.hospitalName)), action: "/doctor/profile/edit", actionLabel: "Add your primary practice" },
  { field: "city", label: "City", weight: 4, done: (d) => Boolean(text(d.city)), action: "/doctor/profile/edit", actionLabel: "Add your city" },
  { field: "state", label: "State", weight: 4, done: (d) => Boolean(text(d.state)), action: "/doctor/profile/edit", actionLabel: "Add your state" },
  { field: "languages", label: "Languages", weight: 4, done: (d) => hasItems(d.languages), action: "/doctor/profile/edit", actionLabel: "Add languages you speak" },
  { field: "licenseNumber", label: "Medical registration", weight: 10, done: (d) => Boolean(text(d.licenseNumber)), action: "/doctor/profile/edit", actionLabel: "Add your registration number" },
  { field: "medicalCouncil", label: "Medical council", weight: 6, done: (d) => Boolean(text(d.medicalCouncil)), action: "/doctor/profile/edit", actionLabel: "Add your medical council" },
  { field: "availability", label: "Availability", weight: 8, done: (d) => hasItems(d.availability), action: "/doctor/schedule", actionLabel: "Set your availability" },
  { field: "documents", label: "Verification documents", weight: 4, done: (d) => hasItems(d.documents), action: "/doctor/verification", actionLabel: "Upload verification documents" },
  { field: "education", label: "Education history", weight: 6, done: (d) => hasItems(d.education), action: "/doctor/profile/edit", actionLabel: "Add education history" },
  { field: "experienceEntries", label: "Work experience", weight: 6, done: (d) => hasItems(d.experienceEntries), action: "/doctor/profile/edit", actionLabel: "Add work experience" },
  { field: "subSpecialties", label: "Sub-specialties", weight: 4, done: (d) => hasItems(d.subSpecialties), action: "/doctor/profile/edit", actionLabel: "Add sub-specialties" },
  { field: "clinics", label: "Practice locations", weight: 6, done: (d) => hasItems(d.clinics) || Boolean(text(d.hospitalName)), action: "/doctor/practice", actionLabel: "Complete practice locations" },
  { field: "insuranceAccepted", label: "Insurance networks", weight: 4, done: (d) => hasItems(d.insuranceAccepted), action: "/doctor/profile/edit", actionLabel: "Add accepted insurance networks" },
];

const CATEGORY_FIELDS = {
  identity: ["profilePhoto", "bio", "city", "state", "languages"],
  credentials: ["qualification", "licenseNumber", "medicalCouncil", "education", "experienceEntries"],
  practice: ["hospitalName", "clinics", "availability", "insuranceAccepted"],
  discoverability: ["subSpecialties"],
};

const scoreCategory = (checks, fields) => {
  const selected = checks.filter((c) => fields.includes(c.field));
  const total = selected.reduce((sum, c) => sum + c.weight, 0);
  const earned = selected.filter((c) => c.done).reduce((sum, c) => sum + c.weight, 0);
  return total ? Math.round((earned / total) * 100) : 0;
};

export function buildDoctorProfileIntelligence(doctor, { trustScore = 0 } = {}) {
  const checks = CHECKS.map((definition) => ({
    field: definition.field,
    label: definition.label,
    weight: definition.weight,
    done: Boolean(definition.done(doctor)),
    action: definition.action,
    actionLabel: definition.actionLabel,
  }));

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earnedWeight = checks.filter((c) => c.done).reduce((sum, c) => sum + c.weight, 0);
  const profileQualityScore = Math.round((earnedWeight / totalWeight) * 100);

  const categories = Object.fromEntries(
    Object.entries(CATEGORY_FIELDS).map(([key, fields]) => [key, scoreCategory(checks, fields)]),
  );

  const verifiedDocuments = new Set((doctor.documents || []).filter((d) => d.status === "verified").map((d) => d.type));
  const requiredDocTypes = ["medical_license", "medical_registration", "degree", "government_id"];
  const missingDocuments = requiredDocTypes.filter((type) => !(doctor.documents || []).some((d) => d.type === type));
  const verificationProgress = doctor.verificationStatus === "approved"
    ? 100
    : Math.round((verifiedDocuments.size / requiredDocTypes.length) * 100);

  const discoverable = Boolean(doctor.isActive && doctor.isVerified && doctor.verificationStatus === "approved");
  const attention = [];

  checks.filter((c) => !c.done).sort((a, b) => b.weight - a.weight).slice(0, 6).forEach((c) => {
    attention.push({
      key: c.field,
      severity: c.field === "licenseNumber" || c.field === "medicalCouncil" ? "high" : "medium",
      title: c.label,
      detail: c.actionLabel,
      action: c.action,
    });
  });

  if (doctor.verificationStatus === "not_submitted") {
    attention.unshift({
      key: "verification-not-submitted",
      severity: "high",
      title: "Verification not yet submitted",
      detail: "Complete your onboarding application so an admin can review and approve your account.",
      action: "/doctor/onboarding",
    });
  } else if (doctor.verificationStatus === "pending") {
    attention.unshift({
      key: "verification-pending",
      severity: "high",
      title: "Verification is pending",
      detail: "Complete the verification requirements so your public trust status can be reviewed.",
      action: "/doctor/verification",
    });
  } else if (doctor.verificationStatus === "rejected") {
    attention.unshift({
      key: "verification-rejected",
      severity: "high",
      title: "Verification needs attention",
      detail: doctor.verificationNotes || "Review the verification center and address the rejection.",
      action: "/doctor/verification",
    });
  }

  if (!discoverable && attention.length < 8) {
    attention.push({
      key: "discoverability",
      severity: "high",
      title: "Public profile is not discoverable",
      detail: "Your account must be active and your verification must be approved before public discovery is enabled.",
      action: "/doctor/verification",
    });
  }

  const seoChecks = [
    { key: "bio", label: "Descriptive biography", done: text(doctor.bio).length >= 100 },
    { key: "specialization", label: "Primary specialization", done: Boolean(text(doctor.specialization)) },
    { key: "location", label: "City and state", done: Boolean(text(doctor.city) && text(doctor.state)) },
    { key: "photo", label: "Profile photo", done: Boolean(doctor.profilePhoto) },
    { key: "languages", label: "At least one language", done: hasItems(doctor.languages) },
  ];

  return {
    profileQualityScore,
    profileCompletionPercent: profileQualityScore,
    categories,
    verificationProgressPercent: verificationProgress,
    trustScore: Number.isFinite(Number(trustScore)) ? Math.round(Number(trustScore)) : 0,
    professionalVisibility: {
      isDiscoverable: discoverable,
      reasons: discoverable ? [] : [
        ...(!doctor.isActive ? ["ACCOUNT_INACTIVE"] : []),
        ...(!doctor.isVerified || doctor.verificationStatus !== "approved" ? ["VERIFICATION_NOT_APPROVED"] : []),
      ],
    },
    patientDiscoverability: {
      isDiscoverable: discoverable,
      reasons: discoverable ? [] : [
        ...(!doctor.isActive ? ["ACCOUNT_INACTIVE"] : []),
        ...(!doctor.isVerified || doctor.verificationStatus !== "approved" ? ["VERIFICATION_NOT_APPROVED"] : []),
      ],
    },
    attention,
    missingInformation: checks.filter((c) => !c.done).map((c) => ({ field: c.field, label: c.label })),
    missingDocuments,
    recommendations: attention.slice(0, 5).map((item) => item.detail),
    checks,
    seoChecks,
    publicReadiness: {
      ready: discoverable,
      blockers: discoverable ? [] : [
        ...(!doctor.isActive ? ["Account inactive"] : []),
        ...(!doctor.isVerified || doctor.verificationStatus !== "approved" ? ["Verification not approved"] : []),
      ],
    },
    identity: {
      id: doctor._id?.toString() || "",
      name: doctor.userId?.name || "",
      specialization: doctor.specialization || "",
      qualification: doctor.qualification || "",
      profilePhoto: doctor.profilePhoto || "",
    },
  };
}
