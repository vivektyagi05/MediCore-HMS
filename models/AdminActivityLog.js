import mongoose from "mongoose";

const adminActivityLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    resourceType: {
      type: String,
      required: true,
      index: true,
    },
    resourceId: String,
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ip: String,
  },
  { timestamps: true },
);

adminActivityLogSchema.index({ createdAt: -1 });
adminActivityLogSchema.index({ action: "text", resourceType: "text" });

const AdminActivityLog = mongoose.model("AdminActivityLog", adminActivityLogSchema);

export default AdminActivityLog;
