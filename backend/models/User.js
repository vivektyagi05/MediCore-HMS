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

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, env.bcryptSaltRounds);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
