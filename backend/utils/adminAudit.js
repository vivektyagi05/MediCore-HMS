import AdminActivityLog from "../models/AdminActivityLog.js";

export const writeAdminLog = async ({
  req,
  action,
  resourceType,
  resourceId,
  severity = "info",
  metadata = {},
}) =>
  AdminActivityLog.create({
    actorId: req.user?._id,
    action,
    resourceType,
    resourceId,
    severity,
    metadata,
    ip: req.ip,
  });
