import mongoose from "mongoose";

const insuranceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, required: true, trim: true, maxlength: 120 },
    policyNumber: { type: String, required: true, trim: true, maxlength: 120 },
    policyHolder: { type: String, required: true, trim: true, maxlength: 120 },
    validTill: { type: Date, required: true },
    coverageAmount: { type: Number, default: 0, min: 0 },
    claimStatus: {
      type: String,
      enum: ["not_submitted", "submitted", "in_review", "approved", "rejected"],
      default: "not_submitted",
      index: true,
    },
    document: {
      fileName: String,
      filePath: String,
      mimeType: String,
      uploadedAt: Date,
    },
  },
  { timestamps: true },
);

const Insurance = mongoose.model("Insurance", insuranceSchema);

export default Insurance;
