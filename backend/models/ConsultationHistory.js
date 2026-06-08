import mongoose from "mongoose";

const consultationHistorySchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
    prescriptionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Prescription" }],
    noteIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "MedicalNote" }],
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    uploadedReports: {
      type: [
        {
          title: String,
          fileUrl: String,
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    summary: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

consultationHistorySchema.index({ patientId: 1, createdAt: -1 });

const ConsultationHistory = mongoose.model("ConsultationHistory", consultationHistorySchema);

export default ConsultationHistory;
