// Phase A6.2.3 — Enterprise Automation Studio. Display/config metadata for
// every action type actionExecutor.js actually implements. Kept as a
// separate list (rather than bolted onto actionExecutor.js) so the runtime
// dispatcher stays focused on execution and this stays focused on what the
// Visual Workflow Builder's Action Library panel renders.

export const ACTION_LIBRARY = Object.freeze([
  {
    type: "notify_user",
    label: "Notify User",
    category: "notification",
    description: "Sends a real in-app notification (and realtime socket push) to one user.",
    configFields: [
      { key: "userIdField", label: "User ID field (from trigger payload)", type: "text", placeholder: "userId" },
      { key: "title", label: "Title", type: "text" },
      { key: "message", label: "Message ({{field}} interpolation supported)", type: "textarea" },
      { key: "severity", label: "Severity", type: "select", options: ["info", "warning", "critical"] },
    ],
  },
  {
    type: "notify_role",
    label: "Notify Role",
    category: "notification",
    description: "Sends a real in-app notification to every active user of a role.",
    configFields: [
      { key: "role", label: "Role", type: "select", options: ["super_admin", "doctor", "receptionist", "patient"] },
      { key: "title", label: "Title", type: "text" },
      { key: "message", label: "Message", type: "textarea" },
      { key: "severity", label: "Severity", type: "select", options: ["info", "warning", "critical"] },
    ],
  },
  {
    type: "notify_admins",
    label: "Broadcast to Admins",
    category: "notification",
    description: "Sends a real in-app notification to every active admin/super admin.",
    configFields: [
      { key: "title", label: "Title", type: "text" },
      { key: "message", label: "Message", type: "textarea" },
      { key: "severity", label: "Severity", type: "select", options: ["info", "warning", "critical"] },
    ],
  },
  {
    type: "reminder_note",
    label: "Reminder Note",
    category: "notification",
    description: "Sends an immediate reminder-type notification. No background scheduler exists in this codebase, so this fires now, not later — see actionExecutor.js's audit note.",
    configFields: [
      { key: "userIdField", label: "User ID field (from trigger payload)", type: "text" },
      { key: "title", label: "Title", type: "text" },
      { key: "message", label: "Message", type: "textarea" },
    ],
  },
  {
    type: "activity_log",
    label: "Write Activity Log",
    category: "audit",
    description: "Writes a real AdminActivityLog entry — the same audit trail every admin action already writes to.",
    configFields: [
      { key: "action", label: "Action label", type: "text" },
      { key: "severity", label: "Severity", type: "select", options: ["info", "warning", "critical"] },
      { key: "note", label: "Note", type: "textarea" },
    ],
  },
  {
    type: "feature_toggle",
    label: "Update Feature Toggle",
    category: "platform",
    description: "Updates a real, existing FeatureToggle document's enabled state or rollout percentage.",
    configFields: [
      { key: "key", label: "Feature toggle key", type: "text" },
      { key: "isEnabled", label: "Enabled", type: "boolean" },
      { key: "rolloutPercentage", label: "Rollout %", type: "number" },
    ],
  },
  {
    type: "webhook",
    label: "Outbound Webhook",
    category: "integration",
    description: "Sends a real HTTP POST with the trigger payload to an admin-configured URL. New capability — this codebase previously only received webhooks, never sent one.",
    configFields: [{ key: "url", label: "Webhook URL", type: "text", placeholder: "https://" }],
  },
  {
    type: "ai_insight",
    label: "AI Insight",
    category: "ai",
    description: "Generates a grounded AI explanation of the trigger event via the existing AI pipeline (automationFlowExplain). Never invents data.",
    configFields: [],
  },
  {
    type: "assignment_recommend",
    label: "Assignment Recommendation",
    category: "assignment",
    description: "Asks the existing Smart Assignment Engine for its top candidate for a real Operation Registry item. Only works when the trigger payload includes a real operationKey.",
    configFields: [{ key: "limit", label: "Candidates to consider", type: "number" }],
  },
  {
    type: "workflow_escalate",
    label: "Escalate Operation Item",
    category: "workflow",
    description: "Delegates to the existing Workflow Engine's escalate transition for a real Operation Registry item. Only works when the trigger payload includes a real operationKey.",
    configFields: [{ key: "escalateToUserId", label: "Escalate to (admin user ID)", type: "text" }],
  },
  {
    type: "workflow_resolve",
    label: "Approve / Resolve Operation Item",
    category: "workflow",
    // Phase A6.3.3 — added for the Process Designer's Approval node, which
    // needed a genuine "approve" outcome distinct from escalate. Delegates
    // to the same real Workflow Engine RESOLVE transition every manual
    // Operations Queue "Resolve" button already uses.
    description: "Delegates to the existing Workflow Engine's resolve transition for a real Operation Registry item. Only works when the trigger payload includes a real operationKey.",
    configFields: [{ key: "note", label: "Resolution note", type: "textarea" }],
  },
]);

export function listActionDefinitions() {
  return ACTION_LIBRARY;
}

export function getActionDefinition(type) {
  return ACTION_LIBRARY.find((a) => a.type === type) || null;
}
