import mongoose from "mongoose";

const medicalReportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "FamilyMember", index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    isPinned: { type: Boolean, default: false, index: true },
    // Phase D5 addition — patient-declared clinical urgency at upload time.
    // Purely additive/optional: existing documents default to "normal" and
    // every prior consumer (search, timeline, reports list) is unaffected.
    // Used only to trigger the priority "critical report uploaded" doctor
    // notification (see patientWorkflowController.uploadReport); never used
    // to infer or fabricate a diagnosis.
    severity: { type: String, enum: ["normal", "urgent", "critical"], default: "normal", index: true },
    // Phase D5 addition — lets the doctor mark a report as reviewed so the
    // Command Center's "pending reports" queue reflects real doctor action
    // instead of a time-based guess. Optional/additive; null means unreviewed.
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, required: true, trim: true, maxlength: 80, index: true },
    reportDate: { type: Date, required: true, index: true },
    notes: { type: String, trim: true, default: "", maxlength: 2000 },
    tags: { type: [String], default: [], index: true },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true },
);

medicalReportSchema.index({ title: "text", notes: "text", tags: "text", category: "text" });

const MedicalReport = mongoose.model("MedicalReport", medicalReportSchema);

export default MedicalReport;
