import mongoose from "mongoose";

const onlineSessionSchema = new mongoose.Schema(
  {
    socketId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, required: true, index: true },
    connectedAt: { type: Date, default: Date.now },
    // No field-level `index: true` here: a single explicit schema-level
    // index below already covers this field (a single-field MongoDB index
    // serves both ascending and descending sorts, plus range queries).
    // Declaring both was a real duplicate-index bug (see historical failure
    // #7 / OnlineSession specifically was missed by the earlier fix pass).
    lastActiveAt: { type: Date, default: Date.now },
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
