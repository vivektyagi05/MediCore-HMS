import mongoose from "mongoose";

const notificationDeliverySchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    type: {
      type: String,
      enum: [
        "appointment",
        "payment",
        "refund",
        "prescription",
        "admin_announcement",
        "chat",
        "dashboard_sync",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    severity: { type: String, enum: ["info", "success", "warning", "critical"], default: "info", index: true },
    deliveredAt: Date,
    readAt: Date,
    eventKey: { type: String, index: true },
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

notificationDeliverySchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
notificationDeliverySchema.index({ eventKey: 1, recipientId: 1 }, { unique: true, sparse: true });

const NotificationDelivery = mongoose.model("NotificationDelivery", notificationDeliverySchema);

export default NotificationDelivery;
