import mongoose from "mongoose";
import CMSPage from "../../models/CMSPage.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const sanitizeContent = (value = "") =>
  String(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .trim();

const pagePayload = (body) => ({
  slug: body.slug?.trim().toLowerCase(),
  title: body.title?.trim(),
  content: sanitizeContent(body.content),
  bannerImage: body.bannerImage?.trim() || "",
  isPublished: Boolean(body.isPublished),
  publishedAt: body.isPublished ? new Date() : undefined,
});

export const listCMSPages = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status === "published") filter.isPublished = true;
  if (req.query.status === "draft") filter.isPublished = false;
  if (req.query.search) filter.title = new RegExp(req.query.search, "i");

  const pages = await CMSPage.find(filter).sort({ updatedAt: -1 }).lean();
  res.status(200).json({ success: true, data: { pages }, message: "CMS pages fetched successfully" });
});

export const upsertCMSPage = asyncHandler(async (req, res) => {
  const payload = pagePayload(req.body);
  if (!payload.slug || !payload.title || !payload.content) throw new AppError("Slug, title, and content are required", 400);

  const page = await CMSPage.findOneAndUpdate(
    { slug: payload.slug },
    { ...payload, $setOnInsert: { createdBy: req.user._id }, updatedBy: req.user._id },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  await writeAdminLog({ req, action: "cms.upsert", resourceType: "cms_page", resourceId: page._id.toString() });
  res.status(200).json({ success: true, data: { page }, message: "CMS page saved successfully" });
});

export const updateCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid page id", 400);
  const page = await CMSPage.findByIdAndUpdate(
    req.params.id,
    { ...pagePayload(req.body), updatedBy: req.user._id },
    { returnDocument: "after", runValidators: true },
  );
  if (!page) throw new AppError("CMS page not found", 404);
  await writeAdminLog({ req, action: "cms.update", resourceType: "cms_page", resourceId: page._id.toString() });
  res.status(200).json({ success: true, data: { page }, message: "CMS page updated successfully" });
});

export const deleteCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid page id", 400);
  const page = await CMSPage.findByIdAndDelete(req.params.id);
  if (!page) throw new AppError("CMS page not found", 404);
  await writeAdminLog({ req, action: "cms.delete", resourceType: "cms_page", resourceId: req.params.id, severity: "warning" });
  res.status(200).json({ success: true, data: { id: req.params.id }, message: "CMS page deleted successfully" });
});
