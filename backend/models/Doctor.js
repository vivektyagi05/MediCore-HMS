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
    // Legacy manually-entered slots. Kept for backward compatibility with existing
    // data and any consumer that only reads `timeSlots`. When a structured config
    // (startTime/endTime/slotDurationMinutes) is present, this array is auto-derived
    // by the slot engine on every save -- doctors and patients never type it directly.
    timeSlots: {
      type: [String],
      default: [],
    },
    // Structured schedule config (Time Slot Engine). All optional so existing
    // documents created before this migration keep working unmodified.
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    slotDurationMinutes: { type: Number, default: null, min: 5, max: 240 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 120 },
    breaks: {
      type: [
        {
          start: { type: String, required: true },
          end: { type: String, required: true },
        },
      ],
      default: [],
    },
    maxPatientsPerSlot: { type: Number, default: 1, min: 1, max: 20 },
    emergencySlotsPerDay: { type: Number, default: 0, min: 0, max: 20 },
  },
  {
    _id: false,
    validate: {
      validator(doc) {
        const hasStructured = doc.startTime && doc.endTime && doc.slotDurationMinutes;
        return hasStructured || (Array.isArray(doc.timeSlots) && doc.timeSlots.length > 0);
      },
      message: "Provide either a structured schedule (startTime/endTime/slotDurationMinutes) or at least one manual time slot",
    },
  },
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
    specializationMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MasterData",
      default: null,
      index: true,
    },
    specializationType: {
      type: String,
      enum: ["MASTER", "OTHER"],
      default: "MASTER",
    },
    specializationOther: {
      type: String,
      trim: true,
      default: "",
      maxlength: 100,
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
            // Verification Center (Phase D4, additive): widened from the original
            // 4 generic categories to the real compliance document types the
            // Verification Center needs to track individually (license,
            // registration, degree, government ID, PAN, GST, clinic
            // registration). Existing "certification"/"identity"/"profile"/
            // "other" values on already-uploaded documents remain valid and
            // unchanged -- this only adds new allowed values going forward.
            enum: [
              "certification",
              "identity",
              "profile",
              "medical_license",
              "medical_registration",
              "degree",
              "government_id",
              "pan",
              "gst",
              "clinic_registration",
              "other",
            ],
            default: "other",
          },
          title: { type: String, required: true, trim: true },
          fileName: { type: String, required: true },
          // Opaque storage key (e.g. "doctor-documents/<uuid>.pdf"), resolved
          // through storage/storageService.js -- never a raw filesystem path.
          // Previously this field WAS a raw disk path (filePath) that was
          // both stored in the DB and returned verbatim in
          // getDoctorDocuments' JSON response straight to the doctor's own
          // browser. Renamed as part of that fix; see
          // migrations/007_doctor_documents_storage_key.js for any
          // previously-uploaded documents.
          storageKey: { type: String, required: true },
          mimeType: { type: String, required: true },
          // Verification Center (Phase D4, additive): real file size in bytes,
          // captured at upload time from multer's req.file.size. Optional/
          // defaulted so pre-existing documents (uploaded before this field
          // existed) simply have no size on record rather than a fabricated
          // one -- Storage usage in the Subscription Center only sums
          // documents that actually have this field set.
          fileSize: { type: Number, default: null },
          status: {
            type: String,
            enum: ["pending", "verified", "rejected"],
            default: "pending",
          },
          // ── Clinical Intelligence Workspace (Phase D2, additive) ──
          // Optional expiry/renewal tracking for licenses/registrations that
          // have a validity window. Undefined for documents that never had
          // one (e.g. identity proofs) — no expiry alert is fabricated for
          // those, they simply never appear in the expiry/renewal list.
          expiryDate: { type: Date, default: null },
          verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          verifiedAt: Date,
          verificationNotes: { type: String, trim: true, default: "" },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    // Reusable medicine sets a doctor writes often — pure convenience data,
    // never auto-applied to a prescription without the doctor picking it.
    medicineTemplates: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 120 },
          medicines: {
            type: [
              {
                name: { type: String, required: true, trim: true },
                dosage: { type: String, required: true, trim: true },
                frequency: { type: String, required: true, trim: true },
                duration: { type: String, required: true, trim: true },
                instructions: { type: String, trim: true, default: "" },
              },
            ],
            default: [],
          },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    favouriteMedicines: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          dosage: { type: String, trim: true, default: "" },
          frequency: { type: String, trim: true, default: "" },
          duration: { type: String, trim: true, default: "" },
          instructions: { type: String, trim: true, default: "" },
          addedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    // Named, reusable weekly-schedule configs a doctor can apply in one
    // click instead of re-entering the same working hours (Session Templates).
    scheduleTemplates: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 80 },
          availability: { type: mongoose.Schema.Types.Mixed, default: [] },
          createdAt: { type: Date, default: Date.now },
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
      cityMasterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MasterData",
        default: null,
        index: true,
      },
      cityType: {
        type: String,
        enum: ["MASTER", "OTHER"],
        default: "OTHER",
      },
      cityOther: {
        type: String,
        trim: true,
        default: "",
        maxlength: 100,
      },

      state: {
        type: String,
        trim: true,
        default: "",
      },
      stateMasterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MasterData",
        default: null,
        index: true,
      },
      stateType: {
        type: String,
        enum: ["MASTER", "OTHER"],
        default: "OTHER",
      },
      stateOther: {
        type: String,
        trim: true,
        default: "",
        maxlength: 100,
      },

      // P12: optional authoritative geography. District/coordinates are never
      // inferred or backfilled from city strings.
      district: {
        type: String,
        trim: true,
        default: "",
        maxlength: 120,
        index: true,
      },
      districtMasterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MasterData",
        default: null,
        index: true,
      },
      districtType: {
        type: String,
        enum: ["MASTER", "OTHER"],
        default: "OTHER",
      },
      districtOther: {
        type: String,
        trim: true,
        default: "",
        maxlength: 120,
      },

      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: undefined,
        },
        coordinates: {
          type: [Number],
          validate: {
            validator(value) {
              return value == null || (Array.isArray(value) && value.length === 2 &&
                value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90);
            },
            message: "location.coordinates must be [longitude, latitude]",
          },
          default: undefined,
        },
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

      // "not_submitted" is the real initial state for a doctor who has never
      // completed onboarding. Before this fix the default was "pending" —
      // indistinguishable from "submitted and awaiting admin review" — so a
      // brand-new doctor's FIRST submitOnboarding() call was rejected with
      // "already under review" (409), permanently blocking them. See
      // services/doctorLifecycleService.js for the canonical state machine
      // this field now follows, and migrations/006_doctor_verification_not_submitted.js
      // for the one-time backfill of existing data.
      verificationStatus: {
        type: String,
        enum: ["not_submitted", "pending", "approved", "rejected"],
        default: "not_submitted",
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

        // ── Professional Profile / Practice Management Platform (Phase D4, additive) ──
        // Every field below is optional/defaulted so all pre-existing Doctor
        // documents remain valid unmodified. `experience` (years, Number)
        // above is kept as-is for backward compatibility with search
        // filters/sorting; `experienceEntries` adds the structured work
        // history the Professional Profile page displays.
        subSpecialties: { type: [String], default: [] },

        education: {
          type: [
            {
              degree: { type: String, required: true, trim: true, maxlength: 120 },
              institution: { type: String, required: true, trim: true, maxlength: 160 },
              year: { type: Number, min: 1950, max: 2100 },
            },
          ],
          default: [],
        },

        experienceEntries: {
          type: [
            {
              title: { type: String, required: true, trim: true, maxlength: 120 },
              organization: { type: String, required: true, trim: true, maxlength: 160 },
              startYear: { type: Number, min: 1950, max: 2100 },
              endYear: { type: Number, min: 1950, max: 2100, default: null },
              description: { type: String, trim: true, default: "", maxlength: 500 },
            },
          ],
          default: [],
        },

        awards: {
          type: [
            {
              title: { type: String, required: true, trim: true, maxlength: 160 },
              issuer: { type: String, trim: true, default: "", maxlength: 160 },
              year: { type: Number, min: 1950, max: 2100 },
            },
          ],
          default: [],
        },

        researchPublications: {
          type: [
            {
              title: { type: String, required: true, trim: true, maxlength: 240 },
              year: { type: Number, min: 1950, max: 2100 },
              link: { type: String, trim: true, default: "", maxlength: 300 },
            },
          ],
          default: [],
        },

        memberships: {
          type: [
            {
              name: { type: String, required: true, trim: true, maxlength: 160 },
              since: { type: Number, min: 1950, max: 2100 },
            },
          ],
          default: [],
        },

        // Multiple clinics (Step 3). `hospitalName`/`city`/`state` above stay
        // the doctor's primary practice location for backward compatibility
        // with search/discovery filters; this adds any additional locations.
        clinics: {
          type: [
            {
              name: { type: String, required: true, trim: true, maxlength: 160 },
              address: { type: String, trim: true, default: "", maxlength: 300 },
              city: { type: String, trim: true, default: "", maxlength: 100 },
              cityMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterData", default: null },
              cityType: { type: String, enum: ["MASTER", "OTHER"], default: "OTHER" },
              cityOther: { type: String, trim: true, default: "", maxlength: 100 },
              state: { type: String, trim: true, default: "", maxlength: 100 },
              stateMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterData", default: null },
              stateType: { type: String, enum: ["MASTER", "OTHER"], default: "OTHER" },
              stateOther: { type: String, trim: true, default: "", maxlength: 100 },
              district: { type: String, trim: true, default: "", maxlength: 120 },
              districtMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "MasterData", default: null },
              districtType: { type: String, enum: ["MASTER", "OTHER"], default: "OTHER" },
              districtOther: { type: String, trim: true, default: "", maxlength: 120 },
              location: {
                type: { type: String, enum: ["Point"], default: undefined },
                coordinates: {
                  type: [Number],
                  validate: {
                    validator(value) {
                      return value == null || (Array.isArray(value) && value.length === 2 &&
                        value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90);
                    },
                    message: "clinic.location.coordinates must be [longitude, latitude]",
                  },
                  default: undefined,
                },
              },
              phone: { type: String, trim: true, default: "", maxlength: 30 },
              isPrimary: { type: Boolean, default: false },
            },
          ],
          default: [],
        },

        clinicPhotos: { type: [String], default: [] },

        emergencyAvailability: { type: Boolean, default: false },

        insuranceAccepted: { type: [String], default: [] },

        // Practice Analytics (Step 6): real counter incremented on every
        // public profile view (see publicController.getDoctorPublicProfile).
        // Never backfilled or estimated -- starts at 0 for every doctor and
        // only grows from genuine page views.
        profileViews: { type: Number, default: 0 },

        // Verification Center (Step 4): timeline of real status changes.
        // Additive alongside the existing single verifiedBy/verifiedAt/
        // verificationNotes fields (which continue to reflect the latest
        // state) -- this keeps the full history those fields alone can't.
        verificationHistory: {
          type: [
            {
              status: { type: String, enum: ["pending", "approved", "rejected"], required: true },
              notes: { type: String, trim: true, default: "" },
              changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
              changedAt: { type: Date, default: Date.now },
            },
          ],
          default: [],
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
doctorSchema.index({ verificationStatus: 1, isVerified: 1, isActive: 1, rating: -1 });
doctorSchema.index({ userId: 1, verificationStatus: 1, isVerified: 1, isActive: 1 });
doctorSchema.index({ location: "2dsphere" });

doctorSchema.pre("validate", async function validateDoctorUser() {
  if (!this.isNew && !this.isModified("userId")) return;

  const user = await User.findById(this.userId).select("role isActive").lean();

  if (!user || !user.isActive || user.role !== ROLES.DOCTOR) {
    this.invalidate("userId", "Doctor profile must be linked to an active doctor user");
  }
});

const Doctor = mongoose.model("Doctor", doctorSchema);

export default Doctor;
