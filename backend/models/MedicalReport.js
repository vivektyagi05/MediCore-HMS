import mongoose from "mongoose";

const medicalReportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    familyMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "FamilyMember", index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true },
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
