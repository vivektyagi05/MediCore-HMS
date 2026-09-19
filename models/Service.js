import mongoose from "mongoose";

const localizedContentSchema = new mongoose.Schema(
  {
    hi: { type: mongoose.Schema.Types.Mixed, default: {} },
    hinglish: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false, strict: false },
);

const seoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 160, default: "" },
    description: { type: String, trim: true, maxlength: 320, default: "" },
    canonical: { type: String, trim: true, maxlength: 500, default: "" },
    robots: { type: String, enum: ["index,follow", "noindex,nofollow"], default: "index,follow" },
  },
  { _id: false },
);

const serviceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120, index: true },
    slug: { type: String, trim: true, lowercase: true, maxlength: 160, unique: true, sparse: true, index: true },
    shortDescription: { type: String, trim: true, maxlength: 320, default: "" },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    benefits: { type: [String], default: [] },
    eligibility: { type: String, trim: true, maxlength: 2000, default: "" },
    preparation: { type: String, trim: true, maxlength: 3000, default: "" },
    procedureInformation: { type: String, trim: true, maxlength: 5000, default: "" },
    duration: { type: String, trim: true, maxlength: 120, default: "" },
    consultationModes: { type: [String], enum: ["online", "in_clinic", "home_visit"], default: [] },
    price: { type: Number, required: true, min: 0, index: true },
    category: { type: String, required: true, trim: true, maxlength: 80, index: true },
    relatedSpecialties: { type: [String], default: [] },
    relatedDoctors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Doctor" }],
    relatedServices: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
    status: { type: String, enum: ["draft", "review", "published", "archived"], default: "draft", index: true },
    visibility: { type: String, enum: ["public", "private"], default: "public", index: true },
    featured: { type: Boolean, default: false, index: true },
    displayOrder: { type: Number, default: 0, index: true },
    localizedContent: { type: localizedContentSchema, default: () => ({}) },
    seo: { type: seoSchema, default: () => ({}) },
    icon: { type: String, trim: true, default: "" },
    image: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true, index: true }, // legacy public-state compatibility
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: { transform(_doc, ret) { delete ret.__v; return ret; } },
  },
);

serviceSchema.index({ title: "text", shortDescription: "text", description: "text", category: "text", benefits: "text", relatedSpecialties: "text" });
serviceSchema.index({ status: 1, visibility: 1, featured: -1, displayOrder: 1, createdAt: -1 });
serviceSchema.index({ category: 1, status: 1, visibility: 1 });

const Service = mongoose.model("Service", serviceSchema);
export default Service;
