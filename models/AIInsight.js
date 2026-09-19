import mongoose from "mongoose";

const aiInsightSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["admin", "doctor", "patient", "system"],
      required: true,
      index: true,
    },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    insightType: {
      type: String,
      enum: [
        "appointment_peak",
        "doctor_overload",
        "revenue_forecast",
        "cancellation_risk",
        "patient_return",
        "schedule_optimization",
        "refund_risk",
        "reminder",
        "chatbot",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    summary: { type: String, required: true, trim: true, maxlength: 1500 },
    recommendation: { type: String, trim: true, maxlength: 1500 },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "low", index: true },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    status: { type: String, enum: ["active", "dismissed", "resolved"], default: "active", index: true },
    generatedBy: { type: String, default: "hms-rule-engine" },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, index: true },
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

aiInsightSchema.index({ scope: 1, insightType: 1, createdAt: -1 });
aiInsightSchema.index({ targetUserId: 1, status: 1, createdAt: -1 });

const AIInsight = mongoose.model("AIInsight", aiInsightSchema);

export default AIInsight;
