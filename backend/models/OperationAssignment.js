import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.1 — Unified Operations Queue.
//
// AUDIT FINDING: every operational item this phase surfaces (pending doctor
// verification, pending refund, open insurance claim, critical unreviewed
// report, failed payment, failed webhook, failed automation run, delayed
// appointment, high-risk patient today, unread critical alert) already
// exists as a real document in its own collection (Doctor, RefundRequest,
// Insurance, MedicalReport, Payment, WebhookEvent, CronRunLog, Appointment,
// NotificationDelivery). None of those collections has a field for "who is
// working this" or an assign/claim/escalate/resolve lifecycle — that gap is
// what this model fills. It is a thin overlay, never a copy of source data.
//
// Keyed by a stable synthetic operationKey: `${type}:${sourceId}` for every
// document-backed item, or `${type}:${dateStamp}` for the platform-wide
// aggregate items (high-risk-patients-today / delayed-appointments-today)
// that have one row per real underlying document already (see
// operationsAdminController.js) — every operationKey in this phase maps to
// exactly one real source document.
//
// AUDIT FINDING (Phase A6.2.2 — Smart Assignment Engine): this overlay never
// persisted the source operation's own `createdAt`/`priority`. That was
// harmless for A6.1/A6.2.1 (both only ever read the CURRENT queue, joining
// fresh against fetchRawOperations()), but it is a real, previously-hidden
// gap for any historical calculation: once a source record leaves the
// pending/open state it was queried in (e.g. a Doctor gets verified, a
// RefundRequest gets approved), it stops matching fetchRawOperations()'s
// filters and disappears from the live queue — while this overlay row
// (with its resolvedAt/timeline) lives on. Without the original createdAt
// and priority captured somewhere, Average Resolution Time, SLA Success %,
// and every other resolved-item metric the Assignment Analytics module
// needs would be mathematically impossible for anything already resolved.
// Fixed by persisting both fields once, at first-touch time (via
// $setOnInsert in workflowEngine.executeWorkflowTransition — the item's
// real createdAt/priority are still available at that moment because the
// source was, by definition, still in the live queue for the action to
// have found it).
// ─────────────────────────────────────────────────────────────────────────
const operationAssignmentSchema = new mongoose.Schema(
  {
    operationKey: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["open", "claimed", "assigned", "escalated", "resolved", "cancelled"],
      default: "open",
      index: true,
    },
    // Phase A6.2.2 additive fix — see AUDIT FINDING above. Never overwritten
    // after insert (no $set touches these keys anywhere in the codebase).
    sourceCreatedAt: { type: Date, default: null },
    sourcePriority: { type: String, enum: ["critical", "high", "medium", "low", null], default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    pinned: { type: Boolean, default: false, index: true },
    resolutionNote: { type: String, trim: true, maxlength: 1000, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    timeline: {
      type: [
        {
          action: { type: String, required: true },
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          // Phase A6.2.2 additive fix: assign/escalate entries previously
          // recorded WHO acted (actorId) and a human-readable note ("Assigned
          // to Priya") but never the target user's id in a queryable field —
          // fine for the Timeline UI (which only ever displays the note),
          // but it meant AssignmentHistory could not programmatically
          // compute per-admin acceptance time or received-escalation counts
          // without parsing display text. Populated going forward for
          // assign/escalate only; left null for actions with no target.
          targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          note: { type: String, trim: true, maxlength: 1000 },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

const OperationAssignment = mongoose.model("OperationAssignment", operationAssignmentSchema);

export default OperationAssignment;
