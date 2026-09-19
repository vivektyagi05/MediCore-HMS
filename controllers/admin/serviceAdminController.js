import mongoose from "mongoose";
import Service from "../../models/Service.js";
import Doctor from "../../models/Doctor.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { normalizeSeo, objectIdArray, slugify, stringArray } from "../../services/contentHelpers.js";

const ALLOWED_STATUS = new Set(["draft", "review", "published", "archived"]);
const ALLOWED_MODES = new Set(["online", "in_clinic", "home_visit"]);

const cleanModes = (value) => Array.isArray(value) ? [...new Set(value.filter((v) => ALLOWED_MODES.has(v)))] : [];

const buildPayload = (body, { partial = false } = {}) => {
  const payload = {};
  const set = (key, value) => { if (!partial || body[key] !== undefined) payload[key] = value; };
  set("title", String(body.title ?? "").trim());
  set("slug", slugify(body.slug || body.title));
  set("shortDescription", String(body.shortDescription ?? "").trim());
  set("description", String(body.description ?? "").trim());
  set("benefits", stringArray(body.benefits));
  set("eligibility", String(body.eligibility ?? "").trim());
  set("preparation", String(body.preparation ?? "").trim());
  set("procedureInformation", String(body.procedureInformation ?? "").trim());
  set("duration", String(body.duration ?? "").trim());
  set("consultationModes", cleanModes(body.consultationModes));
  set("price", body.price === "" || body.price === null ? NaN : Number(body.price));
  set("category", String(body.category ?? "").trim());
  set("relatedSpecialties", stringArray(body.relatedSpecialties));
  set("relatedDoctors", objectIdArray(body.relatedDoctors));
  set("relatedServices", objectIdArray(body.relatedServices));
  set("visibility", body.visibility === "private" ? "private" : "public");
  set("status", ALLOWED_STATUS.has(body.status) ? body.status : body.status === undefined && partial ? undefined : "draft");
  set("featured", Boolean(body.featured));
  set("displayOrder", Number.isFinite(Number(body.displayOrder)) ? Number(body.displayOrder) : 0);
  set("localizedContent", body.localizedContent && typeof body.localizedContent === "object" ? body.localizedContent : {});
  set("seo", normalizeSeo(body.seo));
  set("icon", String(body.icon ?? "").trim());
  set("image", String(body.image ?? "").trim());
  if (!partial || body.isActive !== undefined) payload.isActive = Boolean(body.isActive);
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
};

export const buildUpdatePayload = (body) =>
  buildPayload(body, { partial: true });

export const validateService = (payload, partial = false) => {
  const errors = {};
  if (!partial || payload.title !== undefined) if (!payload.title || payload.title.length < 2) errors.title = "Title is required";
  if (!partial || payload.description !== undefined) if (!payload.description || payload.description.length < 5) errors.description = "Description is required";
  if (!partial || payload.price !== undefined) if (!Number.isFinite(payload.price) || payload.price < 0) errors.price = "Price must be a non-negative number";
  if (!partial || payload.category !== undefined) if (!payload.category) errors.category = "Category is required";
  if (payload.status && !ALLOWED_STATUS.has(payload.status)) errors.status = "Invalid service status";
  if (payload.slug !== undefined && !payload.slug) errors.slug = "Slug is required";
  if (payload.displayOrder !== undefined && (!Number.isInteger(payload.displayOrder) || payload.displayOrder < 0)) errors.displayOrder = "Display order must be a non-negative integer";
  return { isValid: Object.keys(errors).length === 0, errors };
};

const publicState = (status, visibility) => status === "published" && visibility === "public";

const ensureRelatedRecords = async (payload, serviceId = null) => {
  const doctorIds = payload.relatedDoctors || [];
  const serviceIds = (payload.relatedServices || []).filter((id) => !serviceId || String(id) !== String(serviceId));
  const [doctorCount, serviceCount] = await Promise.all([
    Doctor.countDocuments({ _id: { $in: doctorIds } }),
    Service.countDocuments({ _id: { $in: serviceIds } }),
  ]);
  if (doctorCount !== doctorIds.length) throw new AppError("One or more related doctors do not exist", 400);
  if (serviceCount !== serviceIds.length) throw new AppError("One or more related services do not exist", 400);
};

export const listServices = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};
  if (req.query.search) filter.$text = { $search: req.query.search.trim() };
  if (req.query.category) filter.category = req.query.category.trim();
  if (req.query.status) filter.status = req.query.status;
  if (req.query.visibility) filter.visibility = req.query.visibility;
  if (req.query.featured === "true") filter.featured = true;
  const sortMap = { price_asc: { price: 1 }, price_desc: { price: -1 }, title_asc: { title: 1 }, newest: { createdAt: -1 }, display_order: { displayOrder: 1, title: 1 } };
  const [services, total] = await Promise.all([
    Service.find(filter).sort(sortMap[req.query.sort] || sortMap.newest).skip((page - 1) * limit).limit(limit).lean(),
    Service.countDocuments(filter),
  ]);
  res.json({ success: true, data: { services, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});

export const getService = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid service id", 400);
  const service = await Service.findById(req.params.id).populate({ path: "relatedDoctors", select: "userId specialization qualification city state profilePhoto" }).populate({ path: "relatedServices", select: "title slug status visibility" }).lean();
  if (!service) throw new AppError("Service not found", 404);
  res.json({ success: true, data: { service } });
});

export const getServiceCategories = asyncHandler(async (_req, res) => {
  const categories = await Service.aggregate([{ $group: { _id: "$category", total: { $sum: 1 }, published: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "published"] }, { $eq: ["$visibility", "public"] }] }, 1, 0] } } } }, { $sort: { total: -1 } }]);
  res.json({ success: true, data: { categories: categories.map((c) => ({ name: c._id, total: c.total, published: c.published })) } });
});

export const getServiceStats = asyncHandler(async (_req, res) => {
  const [total, published, review, draft, archived, categories] = await Promise.all([
    Service.countDocuments({}), Service.countDocuments({ status: "published", visibility: "public" }), Service.countDocuments({ status: "review" }), Service.countDocuments({ status: "draft" }), Service.countDocuments({ status: "archived" }), Service.distinct("category"),
  ]);
  res.json({ success: true, data: { total, published, review, draft, archived, categoryCount: categories.filter(Boolean).length } });
});

export const createService = asyncHandler(async (req, res) => {
  const payload = buildPayload(req.body);
  const validation = validateService(payload);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);
  const existing = payload.slug ? await Service.findOne({ slug: payload.slug }).select("_id").lean() : null;
  if (existing) throw new AppError("A service with this slug already exists", 409);
  await ensureRelatedRecords(payload);
  if (payload.status === "published" && !publicState(payload.status, payload.visibility)) payload.status = "draft";
  if (payload.status === "published") payload.isActive = true;
  const service = await Service.create({ ...payload, createdBy: req.user._id, updatedBy: req.user._id });
  await writeAdminLog({ req, action: "service.create", resourceType: "service", resourceId: service._id.toString(), metadata: { title: service.title, status: service.status } });
  res.status(201).json({ success: true, data: { service }, message: "Service created successfully" });
});

export const updateService = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid service id", 400);
  const payload = buildPayload(req.body, { partial: true });
  const validation = validateService(payload, true);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);
  if (payload.relatedDoctors || payload.relatedServices) await ensureRelatedRecords(payload, req.params.id);
  if (payload.slug) {
    const duplicate = await Service.findOne({ slug: payload.slug, _id: { $ne: req.params.id } }).select("_id").lean();
    if (duplicate) throw new AppError("A service with this slug already exists", 409);
  }
  const before = await Service.findById(req.params.id).lean();
  if (!before) throw new AppError("Service not found", 404);
  if (payload.status === "published") payload.isActive = true;
  if (payload.status === "archived" || payload.visibility === "private") payload.isActive = false;
  if (payload.status === undefined && payload.isActive !== undefined) payload.status = payload.isActive ? "published" : "archived";
  const service = await Service.findByIdAndUpdate(req.params.id, { $set: { ...payload, updatedBy: req.user._id } }, { returnDocument: "after", runValidators: true });
  await writeAdminLog({ req, action: payload.status && payload.status !== before.status ? `service.${payload.status}` : "service.update", resourceType: "service", resourceId: service._id.toString(), metadata: { previousStatus: before.status, status: service.status } });
  res.json({ success: true, data: { service }, message: "Service updated successfully" });
});

export const deleteService = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid service id", 400);
  const service = await Service.findByIdAndDelete(req.params.id);
  if (!service) throw new AppError("Service not found", 404);
  await writeAdminLog({ req, action: "service.delete", resourceType: "service", resourceId: req.params.id, severity: "warning" });
  res.json({ success: true, data: { id: req.params.id } });
});

export const publishService = asyncHandler(async (req, res) => updateService({ ...req, body: { status: "published" } }, res));
export const archiveService = asyncHandler(async (req, res) => updateService({ ...req, body: { status: "archived" } }, res));
