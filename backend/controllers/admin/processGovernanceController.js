// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence. Same requireAdmin/requirePermission("manage_settings")
// gate as every prior Process phase — no new roles/permissions invented
// (Section 4H audit finding: the real Permission model cannot support
// creator/reviewer/approver/publisher role separation, so segregation of
// duties below is enforced by comparing actor identity, not role).
// ─────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import ProcessDefinition from "../../models/ProcessDefinition.js";
import AutomationRunLog from "../../models/AutomationRunLog.js";
import ProcessOptimizationRecommendation from "../../models/ProcessOptimizationRecommendation.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";
import { writeAdminLog } from "../../utils/adminAudit.js";
import { generativeAssistant } from "../../ai/generativeAssistant.js";
import { validateProcessGraph } from "../../process-designer/graphValidator.js";
import { assessProcessRisk } from "../../process-designer/riskEngine.js";
import { evaluateGovernance, computeGovernanceHealth } from "../../process-governance/processGovernanceEngine.js";
import { applyPublishMutation } from "./processDesignerController.js";
import {
  buildGovernanceOverview,
  buildApprovalQueue,
  buildComplianceOverview,
  buildGovernanceExceptions,
  buildGovernanceAuditTimelineForKey,
} from "../../process-governance/governanceAggregates.js";
import { clampPagination } from "../../utils/paginationValidation.js";

function serialize(doc) {
  return doc.toObject ? doc.toObject() : doc;
}

async function loadEvidence(doc) {
  const [hasSimulationEvidence, openCriticalFindings] = await Promise.all([
    AutomationRunLog.exists({ processDefinitionId: doc._id, dryRun: true }).then(Boolean),
    ProcessOptimizationRecommendation.countDocuments({ processKey: doc.key, severity: "critical", status: { $nin: ["rejected", "implemented"] } }),
  ]);
  return { hasSimulationEvidence, openCriticalFindings };
}

// ─────────────────────────────────────── Dashboard

export const getOverview = asyncHandler(async (_req, res) => {
  const overview = await buildGovernanceOverview();
  res.json({ success: true, data: overview });
});

// PHASE UI-13 hardening (A2/A4): page/pageSize are clamped here (never
// trusted from the client) before being handed to the aggregate, which
// pre-evaluates+filters the full (ceiling-capped) set and then slices —
// see governanceAggregates.js for why this can't be a plain DB skip/limit.
export const getApprovalQueue = asyncHandler(async (req, res) => {
  const { page, pageSize } = clampPagination(req.query.page, req.query.pageSize);
  const { items, pagination } = await buildApprovalQueue({ page, pageSize });
  res.json({ success: true, data: items, meta: pagination });
});

export const getComplianceMatrix = asyncHandler(async (req, res) => {
  const { page, pageSize } = clampPagination(req.query.page, req.query.pageSize);
  const { items, pagination } = await buildComplianceOverview({ filter: req.query.filter, page, pageSize });
  res.json({ success: true, data: items, meta: pagination });
});

export const getExceptions = asyncHandler(async (_req, res) => {
  const exceptions = await buildGovernanceExceptions();
  res.json({ success: true, data: exceptions });
});

// ─────────────────────────────────────── Process Governance Detail

export const getProcessGovernance = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, evidence);
  const health = computeGovernanceHealth({
    blockers: governance.blockers,
    warnings: governance.warnings,
    approvalRequired: governance.approvalRequired,
    approvalStatus: doc.approval?.status,
  });
  res.json({ success: true, data: { process: doc, governance, health } });
});

export const getAuditTimeline = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const timeline = await buildGovernanceAuditTimelineForKey(doc.key);
  res.json({ success: true, data: timeline });
});

export const updateGovernanceClassification = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);

  const { ownerUserId, criticality, dataSensitivity, patientImpact, financialImpact, documentationRequired, governanceOverride, nextReviewDue } = req.body;
  doc.governance = doc.governance || {};
  if (ownerUserId !== undefined) doc.governance.ownerUserId = ownerUserId ? new mongoose.Types.ObjectId(ownerUserId) : null;
  if (criticality !== undefined) doc.governance.criticality = criticality;
  if (dataSensitivity !== undefined) doc.governance.dataSensitivity = dataSensitivity;
  if (patientImpact !== undefined) doc.governance.patientImpact = Boolean(patientImpact);
  if (financialImpact !== undefined) doc.governance.financialImpact = Boolean(financialImpact);
  if (documentationRequired !== undefined) doc.governance.documentationRequired = Boolean(documentationRequired);
  if (governanceOverride !== undefined) doc.governance.governanceOverride = governanceOverride || null;
  if (nextReviewDue !== undefined) doc.governance.nextReviewDue = nextReviewDue ? new Date(nextReviewDue) : null;

  await doc.save();
  await writeAdminLog({ req, action: "process_governance.update_classification", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { governance: doc.governance } });
  res.json({ success: true, data: serialize(doc) });
});

// ─────────────────────────────────────── Approval Workflow

export const submitForReview = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "valid") throw new AppError(`Cannot submit for review from status "${doc.status}" — the process must be validated first.`, 409);

  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, { risk, ...evidence });
  if (!governance.approvalRequired) {
    throw new AppError("This process's current risk tier does not require governance approval — publish it directly instead.", 409, { governance });
  }

  doc.status = "pending_approval";
  doc.approval = {
    status: "pending",
    submittedBy: req.user._id,
    submittedAt: new Date(),
    submittedReason: req.body.reason || "",
    decidedBy: null,
    decidedAt: null,
    decisionNote: "",
  };
  await doc.save();

  await writeAdminLog({ req, action: "process_governance.submit_review", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { riskLevel: governance.riskLevel } });
  res.json({ success: true, data: serialize(doc) });
});

export const approveGovernance = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "pending_approval") throw new AppError(`Cannot approve a process in status "${doc.status}".`, 409);

  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, { risk, ...evidence });

  // Segregation of duties (Section 6/8) — identity-based, per the audit
  // finding that the real Permission model has no reviewer/approver role.
  const isSameActor = String(doc.createdBy) === String(req.user._id);
  if (governance.segregationRequired && isSameActor) {
    if (req.user.role !== "super_admin" || !req.body.overrideSegregation) {
      throw new AppError(
        "Segregation of duties: this is a critical-risk process and its creator cannot also approve it. A super_admin may override with overrideSegregation + a reason.",
        403,
        { governance },
      );
    }
    doc.governanceExceptions.push({
      type: "emergency_override",
      reason: `Segregation-of-duties override: ${req.body.overrideReason || "no reason given"}`,
      actorId: req.user._id,
      reviewRequired: true,
    });
  }

  // Every FAIL control except "Approval completed" itself must already be
  // clear before an approver can act — approving is exactly what resolves
  // the approval control, so it's excluded from this pre-check.
  const otherFailures = governance.controls.filter((c) => c.status === "FAIL" && c.control !== "Approval completed");
  if (otherFailures.length > 0) {
    throw new AppError("Cannot approve — other governance controls are not satisfied.", 409, { governance, failedControls: otherFailures.map((c) => c.control) });
  }

  const validation = validateProcessGraph({ nodes: doc.nodes, edges: doc.edges });
  if (!validation.valid) throw new AppError("Cannot approve/publish — process has validation errors.", 400, { errors: validation.errors });

  doc.approval.status = "approved";
  doc.approval.decidedBy = req.user._id;
  doc.approval.decidedAt = new Date();
  doc.approval.decisionNote = req.body.decisionNote || "";

  applyPublishMutation(doc, { validation, risk, actorId: req.user._id, changeNote: req.body.changeNote });
  await doc.save();

  await writeAdminLog({ req, action: "process_governance.approve", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), metadata: { riskLevel: governance.riskLevel } });
  res.json({ success: true, data: serialize(doc) });
});

export const rejectGovernance = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "pending_approval") throw new AppError(`Cannot reject a process in status "${doc.status}".`, 409);
  if (!req.body.decisionNote) throw new AppError("A reason is required to reject.", 400);

  doc.status = "draft";
  doc.approval.status = "rejected";
  doc.approval.decidedBy = req.user._id;
  doc.approval.decidedAt = new Date();
  doc.approval.decisionNote = req.body.decisionNote;
  await doc.save();

  await writeAdminLog({ req, action: "process_governance.reject", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), severity: "warning" });
  res.json({ success: true, data: serialize(doc) });
});

export const requestChanges = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (doc.status !== "pending_approval") throw new AppError(`Cannot request changes on a process in status "${doc.status}".`, 409);
  if (!req.body.decisionNote) throw new AppError("A reason is required when requesting changes.", 400);

  doc.status = "draft";
  doc.approval.status = "changes_requested";
  doc.approval.decidedBy = req.user._id;
  doc.approval.decidedAt = new Date();
  doc.approval.decisionNote = req.body.decisionNote;
  await doc.save();

  await writeAdminLog({ req, action: "process_governance.request_changes", resourceType: "ProcessDefinition", resourceId: doc._id.toString() });
  res.json({ success: true, data: serialize(doc) });
});

// ─────────────────────────────────────── Emergency Change Control

export const emergencyPublish = asyncHandler(async (req, res) => {
  if (req.user.role !== "super_admin") throw new AppError("Emergency publish requires super_admin.", 403);
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  if (!["draft", "valid", "pending_approval"].includes(doc.status)) throw new AppError(`Cannot emergency-publish a process in status "${doc.status}".`, 409);
  if (!req.body.reason) throw new AppError("An explicit reason is required for an emergency publish.", 400);

  const validation = validateProcessGraph({ nodes: doc.nodes, edges: doc.edges });
  if (!validation.valid) throw new AppError("Cannot publish — process has validation errors.", 400, { errors: validation.errors });
  const risk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });

  doc.governanceExceptions.push({
    type: "emergency_override",
    reason: req.body.reason,
    actorId: req.user._id,
    reviewRequired: true,
  });
  if (doc.approval) doc.approval.status = doc.approval.status === "pending" ? "approved" : doc.approval.status;

  applyPublishMutation(doc, { validation, risk, actorId: req.user._id, changeNote: `EMERGENCY: ${req.body.reason}` });
  await doc.save();

  await writeAdminLog({ req, action: "process_governance.emergency_publish", resourceType: "ProcessDefinition", resourceId: doc._id.toString(), severity: "critical", metadata: { reason: req.body.reason, riskLevel: risk.level } });
  res.json({ success: true, data: serialize(doc) });
});

export const resolveException = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id);
  if (!doc) throw new AppError("Process definition not found", 404);
  const exception = doc.governanceExceptions.find((e) => String(e._id) === req.params.exceptionId);
  if (!exception) throw new AppError("Governance exception not found", 404);
  exception.reviewedBy = req.user._id;
  exception.reviewedAt = new Date();
  await doc.save();
  await writeAdminLog({ req, action: "process_governance.resolve_exception", resourceType: "ProcessDefinition", resourceId: doc._id.toString() });
  res.json({ success: true, data: serialize(doc) });
});

// ─────────────────────────────────────── AI (grounded only — Section 16)

export const explainGovernance = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, evidence);
  const result = await generativeAssistant.governanceExplain({ name: doc.name, status: doc.status, governance, approval: doc.approval });
  res.json({ success: true, data: result });
});

export const explainApprovalRisk = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, evidence);
  const result = await generativeAssistant.approvalRiskExplain({ name: doc.name, governance, createdBy: doc.createdBy, approval: doc.approval });
  res.json({ success: true, data: result });
});

export const explainCompliance = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const evidence = await loadEvidence(doc);
  const governance = await evaluateGovernance(doc, evidence);
  const result = await generativeAssistant.complianceSummary({ name: doc.name, controls: governance.controls, riskLevel: governance.riskLevel });
  res.json({ success: true, data: result });
});

export const explainChangeImpact = asyncHandler(async (req, res) => {
  const doc = await ProcessDefinition.findById(req.params.id).lean();
  if (!doc) throw new AppError("Process definition not found", 404);
  const otherVersion = Number(req.query.withVersion);
  if (!otherVersion) throw new AppError("withVersion query param is required", 400);
  const other = await ProcessDefinition.findOne({ key: doc.key, version: otherVersion }).lean();
  if (!other) throw new AppError(`Version ${otherVersion} of "${doc.key}" not found`, 404);

  const currentRisk = assessProcessRisk({ nodes: doc.nodes, edges: doc.edges });
  const otherRisk = assessProcessRisk({ nodes: other.nodes, edges: other.edges });
  const result = await generativeAssistant.changeImpactExplain({
    name: doc.name,
    from: { version: other.version, status: other.status, riskLevel: otherRisk.level },
    to: { version: doc.version, status: doc.status, riskLevel: currentRisk.level },
  });
  res.json({ success: true, data: result });
});
