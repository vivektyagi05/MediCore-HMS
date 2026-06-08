import mongoose from "mongoose";

const familyMemberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    relation: { type: String, required: true, trim: true, maxlength: 80 },
    age: { type: Number, required: true, min: 0, max: 130 },
    gender: { type: String, enum: ["male", "female", "other", "prefer_not_to_say"], required: true },
    bloodGroup: { type: String, trim: true, default: "" },
    medicalConditions: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

familyMemberSchema.index({ userId: 1, name: 1, relation: 1 });

const FamilyMember = mongoose.model("FamilyMember", familyMemberSchema);

export default FamilyMember;
