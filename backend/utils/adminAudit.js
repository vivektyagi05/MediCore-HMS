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

// Phase A6.2.3 — Enterprise Automation Studio. writeAdminLog() above always
// requires an HTTP `req` (it reads req.user/req.ip) — every prior caller
// was a route handler. The automation event runner fires from real domain
// events (a payment webhook, a cron job, an appointment status update),
// not from an admin's own HTTP request, so there is no `req` to read. This
// is the same AdminActivityLog write, just without the req dependency —
// actorId is intentionally left unset (the model already allows this; it
// has no `required: true`) so these rows are honestly distinguishable from
// an admin's own action, not attributed to a person who didn't do it.
export const writeSystemLog = async ({ action, resourceType, resourceId, severity = "info", metadata = {} }) =>
  AdminActivityLog.create({ action, resourceType, resourceId, severity, metadata, ip: "automation-studio" });
