import mongoose from "mongoose";
import Service from "../../models/Service.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";

const servicePayload = (body) => ({
  title: body.title?.trim(),
  description: body.description?.trim(),
  price: Number(body.price),
  category: body.category?.trim(),
  icon: body.icon?.trim() || "",
  image: body.image?.trim() || "",
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
});

const validateService = (payload, partial = false) => {
  const errors = {};
  if (!partial || payload.title !== undefined) {
    if (!payload.title || payload.title.length < 2) errors.title = "Title is required";
  }
  if (!partial || payload.description !== undefined) {
    if (!payload.description || payload.description.length < 5) errors.description = "Description is required";
  }
  if (!partial || payload.price !== undefined) {
    if (Number.isNaN(payload.price) || payload.price < 0) errors.price = "Price must be a non-negative number";
  }
  if (!partial || payload.category !== undefined) {
    if (!payload.category) errors.category = "Category is required";
  }
  return { isValid: Object.keys(errors).length === 0, errors };
};

export const listServices = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const filter = {};

  if (req.query.search) filter.$text = { $search: req.query.search };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.status === "active") filter.isActive = true;
  if (req.query.status === "inactive") filter.isActive = false;
  if (req.query.minPrice) filter.price = { ...filter.price, $gte: Number(req.query.minPrice) };
  if (req.query.maxPrice) filter.price = { ...filter.price, $lte: Number(req.query.maxPrice) };

  const [services, total] = await Promise.all([
    Service.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Service.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { services, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
    message: "Services fetched successfully",
  });
});

export const createService = asyncHandler(async (req, res) => {
  const payload = servicePayload(req.body);
  const validation = validateService(payload);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);

  const service = await Service.create({ ...payload, createdBy: req.user._id, updatedBy: req.user._id });
  await writeAdminLog({ req, action: "service.create", resourceType: "service", resourceId: service._id.toString(), metadata: { title: service.title } });

  res.status(201).json({ success: true, data: { service }, message: "Service created successfully" });
});

export const updateService = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid service id", 400);

  const payload = servicePayload(req.body);
  const validation = validateService(payload, true);
  if (!validation.isValid) throw new AppError("Validation failed", 400, validation.errors);

  const service = await Service.findByIdAndUpdate(
    req.params.id,
    { ...payload, updatedBy: req.user._id },
    { returnDocument: "after", runValidators: true },
  );
  if (!service) throw new AppError("Service not found", 404);
  await writeAdminLog({ req, action: "service.update", resourceType: "service", resourceId: service._id.toString() });

  res.status(200).json({ success: true, data: { service }, message: "Service updated successfully" });
});

export const deleteService = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw new AppError("Invalid service id", 400);

  const service = await Service.findByIdAndDelete(req.params.id);
  if (!service) throw new AppError("Service not found", 404);
  await writeAdminLog({ req, action: "service.delete", resourceType: "service", resourceId: req.params.id, severity: "warning" });

  res.status(200).json({ success: true, data: { id: req.params.id }, message: "Service deleted successfully" });
});
