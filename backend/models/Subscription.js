import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", index: true },
    planCode: { type: String, required: true, index: true },
    planName: { type: String, required: true },
    interval: { type: String, enum: ["monthly", "yearly"], required: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["created", "active", "past_due", "cancelled", "expired"], default: "created", index: true },
    razorpaySubscriptionId: { type: String, index: true },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    nextBillingAt: Date,
    autoRenew: { type: Boolean, default: true },
    failedRenewalCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const Subscription = mongoose.model("Subscription", subscriptionSchema);

export default Subscription;
