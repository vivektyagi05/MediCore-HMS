import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { validateFileSignature } from "../../utils/fileValidation.js";
import CMSPage from "../../models/CMSPage.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { normalizeSeo, objectIdArray, sanitizePlainContent, slugify, stringArray } from "../../services/contentHelpers.js";
import { serializeArticlePublic } from "../../services/articlePublicSerializer.js";

const statuses = new Set(["draft", "review", "published", "archived"]);
const buildPayload = (body, partial = false) => {
  const payload = {};
  const set = (key, value) => { if (!partial || body[key] !== undefined) payload[key] = value; };
  set("slug", slugify(body.slug || body.title));
  set("title", String(body.title ?? "").trim());
  set("excerpt", String(body.excerpt ?? "").trim());
  set("content", sanitizePlainContent(body.content));
  set("author", mongoose.Types.ObjectId.isValid(body.author) ? body.author : undefined);
  set("category", String(body.category ?? "").trim());
  set("tags", stringArray(body.tags));
  set("references", Array.isArray(body.references) ? body.references.map((item) => ({
    title: String(item?.title || "").trim().slice(0, 180),
    url: String(item?.url || "").trim().slice(0, 500),
    organization: String(item?.organization || "").trim().slice(0, 120),
  })).filter((item) => item.title && /^https?:\/\//i.test(item.url)).slice(0, 10) : []);
  set("relatedServices", objectIdArray(body.relatedServices));
  set("relatedSpecialties", stringArray(body.relatedSpecialties));
  set("relatedDoctors", objectIdArray(body.relatedDoctors));
  set("contentType", body.contentType === "article" ? "article" : "page");
  set("status", statuses.has(body.status) ? body.status : body.status === undefined && partial ? (body.isPublished === undefined ? undefined : (body.isPublished ? "published" : "draft")) : (body.isPublished ? "published" : "draft"));
  set("visibility", body.visibility === "private" ? "private" : "public");
  set("localizedContent", body.localizedContent && typeof body.localizedContent === "object" ? body.localizedContent : {});
  set("seo", normalizeSeo(body.seo));
  set("bannerImage", String(body.bannerImage ?? "").trim());
  if (!partial && body.isPublished !== undefined) payload.isPublished = Boolean(body.isPublished);
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
};

const validatePayload = (payload, partial = false) => {
  const errors = {};
  if (!partial || payload.slug !== undefined) if (!payload.slug) errors.slug = "Slug is required";
  if (!partial || payload.title !== undefined) if (!payload.title || payload.title.length < 2) errors.title = "Title is required";
  if (!partial || payload.content !== undefined) if (!payload.content) errors.content = "Content is required";
  if (payload.status && !statuses.has(payload.status)) errors.status = "Invalid content status";
  if (payload.contentType === "article" && !payload.category) errors.category = "Article category is required";
  return { isValid: Object.keys(errors).length === 0, errors };
};

const applyPublicationState = (payload, actorId) => {
  if (payload.status === "published" && payload.visibility === "public") {
    payload.isPublished = true;
    payload.publishedAt = new Date();
    payload.publishedBy = actorId;
    payload.archivedAt = null;
    payload.archivedBy = null;
  } else if (payload.status === "archived") {
    payload.isPublished = false;
    payload.publishedAt = null;
    payload.archivedAt = new Date();
    payload.archivedBy = actorId;
  } else if (payload.status) {
    payload.isPublished = false;
    payload.publishedAt = null;
    payload.publishedBy = null;
    payload.archivedAt = null;
    payload.archivedBy = null;
  }
};

const populate = (query) => query
  .populate({ path: "author", select: "name" })
  .populate({ path: "relatedServices", select: "title slug status visibility" })
  .populate({ path: "relatedDoctors", select: "userId specialization qualification city state profilePhoto" });

export const listCMSPages = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};
  if (req.query.contentType) filter.contentType = req.query.contentType;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) filter.$text = { $search: req.query.search.trim() };
  const [pages, total] = await Promise.all([
    populate(CMSPage.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
    CMSPage.countDocuments(filter),
  ]);
  res.json({ success: true, data: { pages, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const getCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid content id", 400);
  const page = await populate(CMSPage.findById(req.params.id)).lean();
  if (!page) throw new AppError("Content not found", 404);
  res.json({ success: true, data: { page } });
});

export const saveCMSPage = asyncHandler(async (req, res) => {
  const payload = buildPayload(req.body);
  const validation = validatePayload(payload);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);
  const duplicate = await CMSPage.findOne({ slug: payload.slug }).select("_id").lean();
  if (duplicate) throw new AppError("A content item with this slug already exists", 409);
  applyPublicationState(payload, req.user._id);
  const page = await CMSPage.create({ ...payload, author: payload.author || req.user._id, createdBy: req.user._id, updatedBy: req.user._id });
  await writeAdminLog({ req, action: payload.status === "published" ? "content.publish" : "content.create", resourceType: page.contentType === "article" ? "article" : "cms_page", resourceId: page._id.toString(), metadata: { title: page.title, status: page.status } });
  res.status(201).json({ success: true, data: { page }, message: "Content saved successfully" });
});

export const updateCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid content id", 400);
  const payload = buildPayload(req.body, true);
  const validation = validatePayload(payload, true);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);
  if (payload.slug) {
    const duplicate = await CMSPage.findOne({ slug: payload.slug, _id: { $ne: req.params.id } }).select("_id").lean();
    if (duplicate) throw new AppError("A content item with this slug already exists", 409);
  }
  const before = await CMSPage.findById(req.params.id).lean();
  if (!before) throw new AppError("Content not found", 404);
  if (payload.status || payload.visibility) applyPublicationState(payload, req.user._id);
  // A normal content edit must not mutate publication state unless lifecycle/visibility was explicitly supplied.
  if (payload.status === undefined && payload.visibility === undefined) {
    delete payload.isPublished;
    delete payload.publishedAt;
    delete payload.publishedBy;
    delete payload.archivedAt;
    delete payload.archivedBy;
  }
  const page = await CMSPage.findByIdAndUpdate(req.params.id, { $set: { ...payload, updatedBy: req.user._id } }, { returnDocument: "after", runValidators: true });
  if (payload.bannerImage !== undefined && payload.bannerImage !== before.bannerImage && before.bannerImage?.startsWith("/uploads/cms/")) {
    fs.unlink(path.resolve(process.cwd(), before.bannerImage.slice(1)), () => {});
  }
  await writeAdminLog({ req, action: payload.status && payload.status !== before.status ? `content.${payload.status}` : "content.update", resourceType: page.contentType === "article" ? "article" : "cms_page", resourceId: page._id.toString(), metadata: { previousStatus: before.status, status: page.status } });
  res.json({ success: true, data: { page }, message: "Content updated successfully" });
});


export const previewCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid content id", 400);
  const page = await populate(CMSPage.findById(req.params.id)).lean();
  if (!page) throw new AppError("Content not found", 404);
  if (page.contentType !== "article") throw new AppError("Only articles support this preview", 400);
  res.json({ success: true, data: { article: serializeArticlePublic(page, req, req.query.locale || "en", { includeContent: true }), unpublished: page.status !== "published" || page.visibility !== "public" } });
});

export const deleteCMSPage = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid content id", 400);
  const page = await CMSPage.findById(req.params.id);
  if (!page) throw new AppError("Content not found", 404);
  if (page.contentType === "article" && page.status === "published") throw new AppError("Published articles must be archived before deletion", 409);
  await CMSPage.findByIdAndDelete(req.params.id);
  if (page.bannerImage?.startsWith("/uploads/cms/")) fs.unlink(path.resolve(process.cwd(), page.bannerImage.slice(1)), () => {});
  await writeAdminLog({ req, action: "content.delete", resourceType: page.contentType === "article" ? "article" : "cms_page", resourceId: req.params.id, severity: "warning" });
  res.json({ success: true, data: { id: req.params.id } });
});

export const uploadCMSBanner = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError("Article banner image is required", 400);
  if (!validateFileSignature(req.file.path, req.file.mimetype)) {
    fs.unlink(req.file.path, () => {});
    throw new AppError("Uploaded image content does not match its declared type", 400);
  }
  const url = `/uploads/cms/${path.basename(req.file.filename)}`;
  res.status(201).json({ success: true, data: { url }, message: "Article banner uploaded successfully" });
});

export const publishCMSPage = asyncHandler(async (req, res) => {
  req.body = { status: "published", visibility: "public" };
  return updateCMSPage(req, res);
});

export const archiveCMSPage = asyncHandler(async (req, res) => {
  req.body = { status: "archived", visibility: "private" };
  return updateCMSPage(req, res);
});
