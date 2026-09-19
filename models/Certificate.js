import mongoose from "mongoose";

// Doctor-issued medical certificates (fitness, sick leave, referral, other).
// Additive-only model — does not touch Prescription/MedicalNote/MedicalReport.
// A certificate is always scoped to one doctor + one patient + (optionally)
// the appointment it was issued from, so wrong-patient issuance is caught the
// same way prescriptions already are (ownership match, not a free-text field).
const certificateSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    type: {
      type: String,
      enum: ["fitness", "sick_leave", "referral", "other"],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    // Free-form structured content — kept flexible since certificate types
    // have different shapes (referral has a referredTo field, sick leave has
    // a date range, etc). Never auto-filled with anything the doctor didn't
    // enter or that isn't already on the linked appointment/patient record.
    content: {
      diagnosis: { type: String, trim: true, default: "", maxlength: 500 },
      validFrom: Date,
      validTill: Date,
      referredTo: { type: String, trim: true, default: "", maxlength: 200 },
      notes: { type: String, trim: true, default: "", maxlength: 2000 },
    },
    pdfPath: String,
    status: { type: String, enum: ["issued", "revoked"], default: "issued", index: true },
    revokedReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

certificateSchema.index({ patientId: 1, createdAt: -1 });
certificateSchema.index({ title: "text", "content.notes": "text" });

const Certificate = mongoose.model("Certificate", certificateSchema);

export default Certificate;
