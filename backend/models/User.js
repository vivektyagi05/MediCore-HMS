import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { ROLE_VALUES, ROLES } from "../constants/roles.js";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      maxlength: 120,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: ROLE_VALUES,
      default: ROLES.PATIENT,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Phase P15 — bumped every time the account's credentials change
    // (password reset). Embedded in every JWT at sign time; authMiddleware
    // rejects any token whose embedded value doesn't match the user's
    // current value. This is what actually invalidates every previously
    // issued session the moment a password reset completes, without
    // needing a server-side token blocklist.
securityVersion: {
      type: Number,
      default: 0,
    },
    // Phase 16 — server-recorded acceptance of the current public Terms and
    // Privacy Policy at account registration. Existing accounts remain
    // untouched; the fields are optional for backward compatibility.
    termsAcceptedAt: Date,
    termsVersion: String,
    privacyPolicyVersion: String,

    // New registrations start unverified. Existing accounts are preserved by
    // the default=true compatibility value; registration explicitly sets false.
    emailVerified: {
      type: Boolean,
      default: true,
      index: true,
    },
    emailVerificationTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    emailVerificationSentAt: {
      type: Date,
      default: null,
      select: false,
    },
    emailVerificationLastUsedHash: {
      type: String,
      default: null,
      select: false,
    },

  doctorOnboardingStatus: {
      type: String,
      enum: [
        "not_started",
        "pending",
        "approved",
        "rejected",
      ],
      default: "not_started",
    },

    doctorVerification: {
      submittedAt: Date,
      reviewedAt: Date,

      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },

      rejectionReason: {
        type: String,
        default: "",
      },
    },
    patientProfile: {
      dateOfBirth: Date,
      gender: {
        type: String,
        enum: ["male", "female", "other", "prefer_not_to_say", ""],
        default: "",
      },
      bloodGroup: {
        type: String,
        trim: true,
        default: "",
      },
      emergencyContact: {
        name: { type: String, trim: true, default: "" },
        phone: { type: String, trim: true, default: "" },
        relation: { type: String, trim: true, default: "" },
      },
      allergies: {
        type: [String],
        default: [],
      },
      address: {
        type: String,
        trim: true,
        default: "",
      },
      // ── Personal Health Intelligence Platform (additive-only) ──
      // Every field below is optional/defaulted so every pre-existing
      // User document and consumer of patientProfile keeps working
      // unmodified. Nothing here duplicates data that already lives on
      // another model (e.g. primary physician stays on SavedDoctor,
      // insurance stays on Insurance) — this only adds genuinely new
      // health-identity fields that had nowhere to live before.
      medicalConditions: {
        type: [String],
        default: [],
      },
      medications: {
        type: [
          {
            name: { type: String, trim: true, required: true, maxlength: 120 },
            dosage: { type: String, trim: true, default: "", maxlength: 60 },
            frequency: { type: String, trim: true, default: "", maxlength: 60 },
          },
        ],
        default: [],
      },
      lifestyle: {
        smokingStatus: {
          type: String,
          enum: ["never", "former", "current", ""],
          default: "",
        },
        alcoholConsumption: {
          type: String,
          enum: ["none", "occasional", "moderate", "frequent", ""],
          default: "",
        },
        exerciseFrequency: {
          type: String,
          enum: ["sedentary", "light", "moderate", "active", ""],
          default: "",
        },
        dietType: { type: String, trim: true, default: "", maxlength: 60 },
        sleepHoursAvg: { type: Number, min: 0, max: 24 },
      },
      vitals: {
        heightCm: { type: Number, min: 0, max: 300 },
        weightKg: { type: Number, min: 0, max: 500 },
        bloodPressureSystolic: { type: Number, min: 0, max: 300 },
        bloodPressureDiastolic: { type: Number, min: 0, max: 200 },
        restingHeartRate: { type: Number, min: 0, max: 300 },
        recordedAt: Date,
      },
      healthGoals: {
        type: [
          {
            title: { type: String, trim: true, required: true, maxlength: 120 },
            targetDate: Date,
            status: {
              type: String,
              enum: ["active", "achieved", "abandoned"],
              default: "active",
            },
            createdAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      // "Doctor preferences" — specialities the patient prefers to be
      // matched with. Primary physician itself is NOT duplicated here;
      // it already lives on SavedDoctor.isPrimaryPhysician.
      preferredSpecializations: {
        type: [String],
        default: [],
      },
      healthPreferences: {
        reminderOptIn: { type: Boolean, default: true },
        preferredConsultationMode: {
          type: String,
          enum: ["in_person", "video", "either", ""],
          default: "",
        },
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.index({ role: 1, isActive: 1 });

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, env.bcryptSaltRounds);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
