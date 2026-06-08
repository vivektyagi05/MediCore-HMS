import mongoose from "mongoose";

const savedDoctorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

savedDoctorSchema.index({ userId: 1, doctorId: 1 }, { unique: true });

const SavedDoctor = mongoose.model("SavedDoctor", savedDoctorSchema);

export default SavedDoctor;
