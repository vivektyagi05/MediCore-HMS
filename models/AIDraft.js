import mongoose from "mongoose";

// Every piece of AI-generated content that could plausibly be saved into a
// real record (clinical note, consultation summary, communication) is
// tracked here so it is always explainable, editable, and requires an
// explicit human approval step before it's treated as final.
const aiDraftSchema = new mongoose.Schema(
  {
    promptKey: { type: String, required: true, index: true },
    scope: { type: String, enum: ["patient", "doctor", "admin", "shared"], required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    relatedEntity: {
      model: { type: String },
      id: { type: mongoose.Schema.Types.ObjectId },
    },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    edited: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "approved", "discarded"], default: "draft", index: true },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    generatedBy: { type: String, default: "hms-template-engine" },
  },
  { timestamps: true },
);

aiDraftSchema.index({ createdBy: 1, promptKey: 1, createdAt: -1 });

const AIDraft = mongoose.model("AIDraft", aiDraftSchema);

export default AIDraft;
