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

const cmsPageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    excerpt: { type: String, trim: true, maxlength: 320, default: "" },
    content: { type: String, required: true, maxlength: 20000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    category: { type: String, trim: true, maxlength: 80, default: "", index: true },
    tags: { type: [String], default: [] },
    references: {
      type: [
        {
          title: { type: String, trim: true, maxlength: 180 },
          url: { type: String, trim: true, maxlength: 500 },
          organization: { type: String, trim: true, maxlength: 120 },
        },
      ],
      default: [],
    },
    relatedServices: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
    relatedSpecialties: { type: [String], default: [] },
    relatedDoctors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Doctor" }],
    contentType: { type: String, enum: ["page", "article"], default: "page", index: true },
    status: { type: String, enum: ["draft", "review", "published", "archived"], default: "draft", index: true },
    visibility: { type: String, enum: ["public", "private"], default: "public", index: true },
    publishedAt: Date,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: Date,
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    localizedContent: { type: localizedContentSchema, default: () => ({}) },
    seo: { type: seoSchema, default: () => ({}) },
    bannerImage: { type: String, trim: true, default: "" },
    isPublished: { type: Boolean, default: false, index: true }, // legacy compatibility
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: { transform(_doc, ret) { delete ret.__v; return ret; } },
  },
);

cmsPageSchema.index({ title: "text", excerpt: "text", content: "text", category: "text", tags: "text", relatedSpecialties: "text" });

const CMSPage = mongoose.model("CMSPage", cmsPageSchema);
export default CMSPage;
