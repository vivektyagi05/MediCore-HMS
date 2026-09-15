import mongoose from "mongoose";

const medicalNoteSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
    symptoms: { type: [String], default: [], index: true },
    notes: { type: String, required: true, trim: true, maxlength: 3000 },
    recommendations: { type: String, trim: true, default: "", maxlength: 2000 },
    attachments: {
      type: [
        {
          title: String,
          fileUrl: String,
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

medicalNoteSchema.index({ notes: "text", recommendations: "text", symptoms: "text" });

const MedicalNote = mongoose.model("MedicalNote", medicalNoteSchema);

export default MedicalNote;
