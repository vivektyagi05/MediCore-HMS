import mongoose from "mongoose";

const onlineSessionSchema = new mongoose.Schema(
  {
    socketId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, required: true, index: true },
    connectedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now, index: true },
    disconnectedAt: Date,
    status: { type: String, enum: ["online", "offline"], default: "online", index: true },
    ipAddress: String,
    userAgent: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

onlineSessionSchema.index({ userId: 1, status: 1 });
onlineSessionSchema.index({ lastActiveAt: -1 });

const OnlineSession = mongoose.model("OnlineSession", onlineSessionSchema);

export default OnlineSession;
