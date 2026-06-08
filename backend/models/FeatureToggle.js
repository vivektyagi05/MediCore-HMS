import mongoose from "mongoose";

const featureToggleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    isEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    rolloutPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
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

const FeatureToggle = mongoose.model("FeatureToggle", featureToggleSchema);

export default FeatureToggle;
