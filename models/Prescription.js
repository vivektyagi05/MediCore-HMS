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
    // Phase DOC-07 final pass — additive. Set once the doctor actually
    // schedules a real Appointment for this prescription's follow-up (via
    // Follow-up → Real Scheduling). Optional/undefined on every existing
    // document and every existing consumer of this model is unaffected.
    followUpScheduledAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
    // Phase P10 (Follow-up/Continuity) — additive. Set when the Appointment
    // this pointed to gets cancelled (see appointmentCancellationService.js),
    // so the continuity loop doesn't silently break: the doctor sees "this
    // was scheduled and then cancelled" rather than the recommendation just
    // vanishing. Cleared automatically the next time a follow-up is
    // successfully (re)scheduled for this prescription. Optional/undefined
    // on every existing document; no consumer that doesn't read it is
    // affected.
    followUpCancelledAt: { type: Date },
    pdfPath: String,
    status: { type: String, enum: ["active", "void"], default: "active", index: true },
  },
  { timestamps: true },
);

prescriptionSchema.index({ patientId: 1, createdAt: -1 });
prescriptionSchema.index({ diagnosis: "text", notes: "text" });

const Prescription = mongoose.model("Prescription", prescriptionSchema);

export default Prescription;
