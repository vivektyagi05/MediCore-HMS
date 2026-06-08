import mongoose from "mongoose";

const symptomSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    symptoms: [{ type: String, trim: true, lowercase: true }],
    duration: { type: String, trim: true, maxlength: 120 },
    severity: { type: String, enum: ["mild", "moderate", "severe"], required: true, index: true },
    urgency: { type: String, enum: ["routine", "soon", "urgent"], required: true, index: true },
    suggestedDepartments: [{ type: String, trim: true }],
    recommendedSpecialists: [{ type: String, trim: true }],
    safetyFlags: [{ type: String, trim: true }],
    disclaimerAccepted: { type: Boolean, default: false },
    recommendationText: { type: String, trim: true, maxlength: 1500 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
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

symptomSessionSchema.index({ userId: 1, createdAt: -1 });

const SymptomSession = mongoose.model("SymptomSession", symptomSessionSchema);

export default SymptomSession;
