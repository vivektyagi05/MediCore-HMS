import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    conversationKey: { type: String, required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    messageType: { type: String, enum: ["text", "system"], default: "text" },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    deliveredAt: Date,
    readAt: Date,
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

chatMessageSchema.index({ conversationKey: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

export default ChatMessage;
