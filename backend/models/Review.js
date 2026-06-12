import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
    isEdited: { type: Boolean, default: false },
    doctorReply: {
      message: {
        type: String,
        trim: true,
        maxlength: 1000,
      },
      repliedAt: Date,
    },
    adminDeleted: {
      type: Boolean,
      default: false,
    },

    adminDeletedAt: Date,

    adminDeletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
  
);

reviewSchema.index({ userId: 1, appointmentId: 1 }, { unique: true });
reviewSchema.index({ doctorId: 1, createdAt: -1 });

const Review = mongoose.model("Review", reviewSchema);

export default Review;
