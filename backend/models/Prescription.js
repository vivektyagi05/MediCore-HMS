import mongoose from "mongoose";

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    frequency: { type: String, required: true, trim: true },
    duration: { type: String, required: true, trim: true },
    instructions: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const prescriptionSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
    diagnosis: { type: String, required: true, trim: true, maxlength: 1000 },
    medicines: {
      type: [medicineSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "At least one medicine is required",
      },
    },
    notes: { type: String, trim: true, default: "", maxlength: 2000 },
    followUpDate: Date,
    pdfPath: String,
    status: { type: String, enum: ["active", "void"], default: "active", index: true },
  },
  { timestamps: true },
);

prescriptionSchema.index({ patientId: 1, createdAt: -1 });
prescriptionSchema.index({ diagnosis: "text", notes: "text" });

const Prescription = mongoose.model("Prescription", prescriptionSchema);

export default Prescription;
