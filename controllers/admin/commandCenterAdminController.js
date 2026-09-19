// PHASE UI-9 — Executive Admin Command Center.
//
// Thin HTTP layer only. Every real number comes from
// backend/services/commandCenter/commandCenterAggregates.js, which itself
// composes exclusively from existing builders (see that file's header for
// the full audit note). This controller's only real job is Section 15
// (Security): resolve the requesting admin's real permissions once, and
// pass them into the aggregator so a section the admin cannot see on its
// own dedicated page (Finance -> manage_payments, Operations/Workflow/
// Governance -> manage_settings) is never included here either — never a
// fabricated zero, an explicit "not permitted" instead.
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { userHasPermission } from "../../middleware/adminMiddleware.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { buildCommandCenterData } from "../../services/commandCenter/commandCenterAggregates.js";

async function resolvePermissions(user) {
  const [canViewFinance, canViewOps] = await Promise.all([
    userHasPermission(user, "manage_payments"),
    userHasPermission(user, "manage_settings"),
  ]);
  return { canViewFinance, canViewOps };
}

export const getCommandCenter = asyncHandler(async (req, res) => {
  const permissions = await resolvePermissions(req.user);
  const data = await buildCommandCenterData(permissions);
  res.status(200).json({ success: true, data, message: "Executive command center fetched successfully" });
});

// AI Executive Summary — advisory only, grounded strictly in the same
// buildCommandCenterData() output the dashboard itself just rendered (no
// second, possibly-divergent fetch). Section 9: AI must not invent a
// metric, and must say "insufficient data" for any section the caller
// could not access — enforced by passing exactly the same
// available/permission-denied shape the aggregator already returns.
export const getCommandCenterExecutiveSummary = asyncHandler(async (req, res) => {
  const permissions = await resolvePermissions(req.user);
  const data = await buildCommandCenterData(permissions);

  const result = await generativeAssistant.commandCenterExecutiveSummary({
    executive: data.executive,
    needsAttention: data.needsAttention,
    finance: data.finance,
    reputation: data.reputation,
    workflow: data.workflow,
    governance: data.governance,
  });

  res.status(200).json({ success: true, data: result, message: "Executive command center summary generated successfully" });
});
