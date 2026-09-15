import mongoose from "mongoose";

const savedDoctorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    notes: { type: String, trim: true, default: "" },
    // ── Patient Care Journey (Saved Doctors → healthcare shortlist) ──
    // Additive-only fields. All optional/defaulted so every pre-existing
    // SavedDoctor document and consumer keeps working unmodified.
    tags: {
      type: [String],
      default: [],
    },
    isPrimaryPhysician: {
      type: Boolean,
      default: false,
    },
    // Real snapshot of the doctor's fee/specialization captured at the
    // moment the patient saved them — used only to detect genuine change
    // (fee went up/down, specialization changed) against the doctor's
    // current live data. Never fabricated, never re-fetched speculatively.
    feesAtSave: {
      type: Number,
    },
    specializationAtSave: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

savedDoctorSchema.index({ userId: 1, doctorId: 1 }, { unique: true });

const SavedDoctor = mongoose.model("SavedDoctor", savedDoctorSchema);

export default SavedDoctor;
