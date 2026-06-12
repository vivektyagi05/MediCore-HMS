import mongoose from "mongoose";

const doctorPayoutSchema =
new mongoose.Schema(
{
  doctorId: {
    type:
      mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true,
    index: true,
  },

  paymentId: {
    type:
      mongoose.Schema.Types.ObjectId,
    ref: "Payment",
    required: true,
  },

  appointmentId: {
    type:
      mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true,
  },

  grossAmount: {
    type: Number,
    required: true,
  },

  platformFee: {
    type: Number,
    default: 0,
  },

  doctorAmount: {
    type: Number,
    required: true,
  },

  status: {
    type: String,
    enum: [
      "pending",
      "paid",
    ],
    default: "pending",
  },

  paidAt: Date,
},
{
  timestamps: true,
}
);

export default mongoose.model(
  "DoctorPayout",
  doctorPayoutSchema
);