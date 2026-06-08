import mongoose from "mongoose";
import { ROLES } from "../constants/roles.js";
import User from "./User.js";

const availabilitySlotSchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: String,
      required: true,
      enum: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      lowercase: true,
    },
    timeSlots: {
      type: [String],
      required: true,
      validate: {
        validator: (slots) => Array.isArray(slots) && slots.length > 0,
        message: "At least one time slot is required",
      },
    },
  },
  { _id: false },
);

const doctorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    specialization: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
      default: "General Medicine",
    },
    experience: {
      type: Number,
      required: true,
      min: 0,
      max: 70,
      default: 0,
    },
    fees: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    availability: {
      type: [availabilitySlotSchema],
      default: [],
    },
    blockedDates: {
      type: [
        {
          date: { type: Date, required: true },
          reason: { type: String, trim: true, default: "" },
        },
      ],
      default: [],
    },
    documents: {
      type: [
        {
          type: {
            type: String,
            enum: ["certification", "identity", "profile", "other"],
            default: "other",
          },
          title: { type: String, required: true, trim: true },
          fileName: { type: String, required: true },
          filePath: { type: String, required: true },
          mimeType: { type: String, required: true },
          status: {
            type: String,
            enum: ["pending", "verified", "rejected"],
            default: "pending",
          },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    licenseNumber: {
        type: String,
        trim: true,
        default: "",
      },

      medicalCouncil: {
        type: String,
        trim: true,
        default: "",
      },

      qualification: {
        type: String,
        trim: true,
        default: "",
      },

      collegeName: {
        type: String,
        trim: true,
        default: "",
      },

      graduationYear: {
        type: Number,
        default: null,
      },

      hospitalName: {
        type: String,
        trim: true,
        default: "",
      },

      city: {
        type: String,
        trim: true,
        default: "",
      },

      state: {
        type: String,
        trim: true,
        default: "",
      },

      bio: {
        type: String,
        trim: true,
        default: "",
      },

      languages: {
        type: [String],
        default: [],
      },

      consultationMode: {
        type: [String],
        default: ["online"],
      },

      profilePhoto: {
        type: String,
        default: "",
      },

      isVerified: {
        type: Boolean,
        default: false,
      },

      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },

      verificationStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },

      verificationNotes: {
          type: String,
          default: "",
        },

        verifiedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },

        verifiedAt: Date,
        rating: {
          type: Number,
          default: 0,
          min: 0,
          max: 5,
        },
      },
      {
        timestamps: true,
        toJSON: {
          transform(_doc, ret) {
            delete ret.__v;
            return ret;
          },
        },
      },
);

doctorSchema.index({ specialization: 1, rating: -1 });

doctorSchema.pre("validate", async function validateDoctorUser() {
  if (!this.isNew && !this.isModified("userId")) return;

  const user = await User.findById(this.userId).select("role isActive").lean();

  if (!user || !user.isActive || user.role !== ROLES.DOCTOR) {
    this.invalidate("userId", "Doctor profile must be linked to an active doctor user");
  }
});

const Doctor = mongoose.model("Doctor", doctorSchema);

export default Doctor;
