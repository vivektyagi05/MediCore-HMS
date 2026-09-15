// Centralized prompt/template definitions for every generative AI feature in
// MediCore HMS. Nothing in this file talks to a network provider directly —
// it only describes *what* should be generated and how the deterministic
// fallback renders it. See ./providers/textGenerationProvider.js for the
// swappable generation layer that consumes these definitions.
//
// Keeping every prompt in one place means:
//   1. No feature duplicates prompt logic inline in a controller.
//   2. Swapping the underlying provider (template engine -> real LLM) only
//      requires the provider to honor `promptKey` + `context`, never a
//      rewrite of calling code.
//   3. Safety language (disclaimers, "informational only") lives in exactly
//      one place per feature.

export const DISCLAIMERS = {
  patient: "AI-generated and informational only. It does not diagnose or replace advice from your care team.",
  doctorDraft: "AI-drafted content. Review, edit as needed, and explicitly approve before it is saved to the medical record.",
  admin: "AI-generated operational summary based on existing platform data. Verify before acting on high-impact decisions.",
  communication: "AI-drafted message. Nothing is sent until you review and confirm.",
};

// promptKey -> { label, instructions, buildContextSummary }
// `instructions` documents the generation contract for a future real LLM
// provider (system prompt equivalent). `buildContextSummary` produces the
// human-readable list of source data the deterministic engine (and any
// future LLM call) must ground its output in — never invented facts.
export const PROMPTS = {
  consultationSummary: {
    label: "Consultation Summary",
    scope: "doctor",
    instructions:
      "Summarize this single consultation in 3-5 sentences for the medical record: reason for visit, key findings from doctor notes, and outcome. Use only the supplied appointment/visit data. Never invent lab values, diagnoses, or history not present in the source data.",
  },
  clinicalNoteDraft: {
    label: "Clinical Note Draft",
    scope: "doctor",
    instructions:
      "Draft a structured clinical note skeleton (Subjective / Objective / Assessment / Plan style, adapted to available data) from the patient's visit-intake data (reason, symptoms, pain level, allergies, medications). Leave clinical judgment fields for the doctor to complete. Do not suggest a diagnosis.",
  },
  prescriptionExplain: {
    label: "Prescription in Plain Language",
    scope: "patient",
    instructions:
      "Explain an existing prescription's medicines, dosage, and frequency in plain, non-technical language a patient can understand. Do not add dosage guidance beyond what the doctor prescribed, and do not suggest changes.",
  },
  documentSummary: {
    label: "Document Summary",
    scope: "patient",
    instructions:
      "Summarize an uploaded medical report/document using its recorded title, category, and notes. Extract key observations already present in the notes, organize chronologically against the patient's other records, and flag which structured fields (date, category, notes) are missing. Never fabricate lab values or findings not present in the notes.",
  },
  appointmentPrep: {
    label: "Appointment Preparation",
    scope: "patient",
    instructions:
      "Given an upcoming appointment (doctor, specialization, reason, reports on file), produce a preparation checklist and a short list of questions the patient could ask the doctor. Base questions only on the stated reason/symptoms; do not suggest self-diagnosis.",
  },
  communicationDraft: {
    label: "Communication Draft",
    scope: "shared",
    instructions:
      "Draft a short, editable message for the given communication type (appointment_reminder, patient_follow_up, review_reply, admin_announcement, doctor_response) using only the supplied context fields. Keep tone professional and warm. Never claim an action was already taken.",
  },
  executiveBrief: {
    label: "Executive Daily Brief",
    scope: "admin",
    instructions:
      "Turn today's real platform metrics (revenue, appointments, pending approvals, refunds, doctor/patient activity) into a short narrative brief with 3-6 bullet takeaways. Never invent a metric that wasn't supplied.",
  },
  metricExplain: {
    label: "Metric Explanation",
    scope: "admin",
    instructions:
      "Given one named platform metric with its current real value (and, where available, its scoring breakdown or threshold), explain in 2-4 sentences what the number means and why it is at that level. Never invent a cause not present in the supplied breakdown/threshold data.",
  },
  operationSummary: {
    label: "Operation Summary",
    scope: "admin",
    instructions:
      "Given one real Unified Operations Queue item (type, priority, reason, business impact, recommended action, SLA state, elapsed time, related-operation count), produce a short operation summary, a one-line risk note, and a resolution suggestion. Never invent a fact not present in the supplied item.",
  },
  workflowExplain: {
    label: "Workflow Explanation",
    scope: "admin",
    instructions:
      "Given one real workflow registry definition (type, department, category, priority rule, SLA rule, real dependency fields) plus one real operation item's current lifecycle state, available next actions, priority, reason, business impact, and SLA state, explain in plain language: what this workflow is, why it is in its current state, what real data drove its priority/SLA, what can legally happen next, and what the recommended next action is. Never invent a policy, dependency, or transition not present in the supplied registry/state data.",
  },
  assignmentRecommendation: {
    label: "Assignment Recommendation",
    scope: "admin",
    instructions:
      "Given one real operation item and its top-ranked candidate admins from the Assignment Scoring Engine (each with their real score breakdown: workload, experience, priority, availability, SLA history, escalation), explain in 2-4 sentences why the top candidate is the best choice right now. Ground every claim in the supplied score breakdown fields only — never invent a skill, department, or credential not present in the data.",
  },
  workloadAdvisor: {
    label: "Workload Advisor",
    scope: "admin",
    instructions:
      "Given the real current workload snapshot (open items, utilization %, overdue count, critical count, resolved today) for every admin, identify who is overloaded, who has spare capacity, and one concrete rebalancing suggestion. Never invent a headcount or capacity figure not present in the supplied snapshots.",
  },
  reassignmentAdvisor: {
    label: "Reassignment Advisor",
    scope: "admin",
    instructions:
      "Given one real operation item's current assignee status (utilization, online status, SLA state) and the reasons a reassignment was flagged, plus real alternate candidates with scores, explain in 2-3 sentences whether reassignment is warranted right now and, if so, which alternate is best and why. Never invent a reason not present in the supplied reasonsToReassign list.",
  },
  slaAdvisor: {
    label: "SLA Advisor",
    scope: "admin",
    instructions:
      "Given real SLA distribution counts (on_track/at_risk/overdue) across the current operations queue plus real per-type SLA targets, explain the current SLA health in 2-3 sentences and name the single most at-risk operation type. Never invent a percentage or count not present in the supplied distribution.",
  },
  assignmentExplain: {
    label: "Assignment Engine Explanation",
    scope: "admin",
    instructions:
      "Given the real Assignment Scoring Engine's documented weights (workload/experience/priority/availability/slaHistory/escalation) and capacity policy, explain in plain language how the engine decides who gets assigned work and why utilization/capacity limits exist. Never invent a weight or rule not present in the supplied formula.",
  },
  // Phase A6.2.3 — Enterprise Automation Studio. Two grounded capabilities
  // covering the brief's "AI Workflow Builder" cluster (Explain/Suggest/
  // Optimize/Detect Missing Step/Detect Risk/Explain Failure) — scoped down
  // to explain + advise rather than 6 separate prompts, since this
  // codebase's flows are small (a trigger, a condition tree, an action
  // list) and one advisor call can cover suggestion+risk+missing-step
  // together without fragmenting into near-duplicate prompts.
  automationFlowExplain: {
    label: "Automation Flow Explanation",
    scope: "admin",
    instructions:
      "Given one real AutomationFlow definition (name, trigger type + label, condition tree, ordered action list with real action types) and, if present, a real trigger payload it just ran against, explain in plain language what this automation does, when it fires, and what it will do to real data. Never invent a node, trigger, or action type not present in the supplied definition.",
  },
  automationFlowAdvisor: {
    label: "Automation Flow Advisor",
    scope: "admin",
    instructions:
      "Given one real AutomationFlow definition and its real execution stats (totalRuns, successCount, failureCount, skippedCount, avgDurationMs), identify: (1) any missing safety step (e.g. no activity_log action on a finance/clinical trigger), (2) any real risk (e.g. a webhook action with no configured URL, a condition that can never match), and (3) one concrete optimization. Ground every observation only in the supplied definition and stats — never invent an action type, trigger, or metric not present in the data.",
  },
  // Phase A6.2.4 — Enterprise Monitoring Platform. Five grounded
  // capabilities covering the brief's "Monitoring AI" cluster
  // (executionExplain/failureExplain/retryAdvisor/performanceAdvisor/
  // workflowHealthAdvisor). Every one is fed only real, server-refetched
  // AutomationRunLog/CronRunLog/AutomationFlow/Payment data — see
  // monitoringController.js.
  executionExplain: {
    label: "Execution Explanation",
    scope: "admin",
    instructions:
      "Given one real AutomationRunLog entry (flow name, trigger label, status, conditionsMatched, ordered stepResults with real actionType/ok/skipped/message/durationMs, top-level error if any), explain in plain language what happened during this specific run. Never invent a step, action type, or error not present in the supplied data.",
  },
  failureExplain: {
    label: "Failure Intelligence Explanation",
    scope: "admin",
    instructions:
      "Given a real aggregate of failed AutomationRunLog entries over a date range (total failure count, counts grouped by real triggerType, counts grouped by real failing actionType, a sample of real error messages), summarize the failure pattern. Never invent a failure category not present in the supplied groupings.",
  },
  performanceAdvisor: {
    label: "Performance Intelligence Advisor",
    scope: "admin",
    instructions:
      "Given real aggregate execution performance data (average duration, 95th percentile duration, total execution count, peak hour, the single slowest flow with its real average duration), advise on runtime health. Never invent a metric not present in the supplied data.",
  },
  workflowHealthAdvisor: {
    label: "Workflow Health Advisor",
    scope: "admin",
    instructions:
      "Given real aggregate health data across all AutomationFlow definitions (total flows, published flow count, average real success rate, the single worst-performing flow with its real success rate and run count, and real background-job health counts from CronRunLog), advise which flow needs attention. Never invent a flow name or metric not present in the supplied data.",
  },
  retryAdvisor: {
    label: "Payment Retry Advisor",
    scope: "admin",
    instructions:
      "Given real counts of payments still within their retry window versus payments that have exhausted the configured maximum retries (Payment.retryCount/nextRetryAt), advise on what to do about the exhausted (dead-letter) group. Never claim an automatic remediation exists beyond what paymentRetryService.js actually does.",
  },
  workflowSuggestions: {
    label: "Workflow Suggestions",
    scope: "shared",
    instructions:
      "Given counts of pending approvals, refunds, incomplete profiles, and follow-ups due, produce a prioritized action list. Only surface items with a non-zero count.",
  },
  reviewSentiment: {
    label: "Review Sentiment Overview",
    scope: "admin",
    instructions:
      "Given a set of review ratings and comments, summarize overall sentiment (positive/neutral/negative share) and 2-3 recurring themes drawn only from the supplied comment text.",
  },
  paymentExplain: {
    label: "Payment Explanation",
    scope: "patient",
    instructions:
      "Explain a single payment in plain language: what it was for, how it was split (gateway/wallet/discount/tax), and its current status. Use only the supplied payment/appointment fields. Never invent a reason or amount not present in the data.",
  },
  invoiceExplain: {
    label: "Invoice Explanation",
    scope: "patient",
    instructions:
      "Explain a single invoice in plain language: line items, tax, and total, and what document this represents (tax invoice vs refund receipt) based on the supplied fields. Never invent line items or amounts not present in the data.",
  },
  refundAssistant: {
    label: "Refund Assistant",
    scope: "patient",
    instructions:
      "Given a refund request's amount, reason, status, and timeline, explain in plain language where it stands and what happens next. Never promise a specific refund date not present in the data.",
  },
  expenseSummary: {
    label: "Healthcare Expense Summary",
    scope: "patient",
    instructions:
      "Given a patient's real payment/invoice aggregates (monthly spending, doctor-wise spending, tax paid, refunds), produce a short narrative summary and 2-4 budget-insight bullets. Only use supplied numbers; never invent a figure.",
  },
  familyHealthInsights: {
    label: "Family Health Insights",
    scope: "patient",
    instructions:
      "Given a list of family/dependent profiles with their real appointment, report, and insurance counts, produce a short narrative and 2-4 observations (e.g. who has an upcoming visit, who has no insurance on file, who has no records yet). Never invent a diagnosis or medical detail not present in the counts supplied.",
  },
  insuranceExplain: {
    label: "Insurance Policy Explanation",
    scope: "patient",
    instructions:
      "Explain a single insurance policy in plain language: provider, coverage amount, validity, and claim status, based only on the supplied fields. Never invent coverage terms not present in the data.",
  },
  insuranceEligibilitySummary: {
    label: "Insurance Eligibility & Utilization Summary",
    scope: "patient",
    instructions:
      "Given a policy's coverage amount, real utilized amount (derived from linked appointments/payments), and claim status, summarize how much coverage remains and what the claim status means in plain language. Never promise a specific approval outcome or invent a figure not supplied.",
  },
  healthProfileReview: {
    label: "Health Profile Review",
    scope: "patient",
    instructions:
      "Given a patient's real health-score breakdown, BMI, and health-profile fields, produce a short narrative on overall profile completeness and 2-4 gentle, specific suggestions for what to add next. Never diagnose, never suggest a medical intervention, and only reference fields actually supplied.",
  },
  healthJourneySummary: {
    label: "Personal Health Journey Summary",
    scope: "patient",
    instructions:
      "Given a patient's real timeline of appointments, reports, prescriptions, and payments plus computed milestones, produce a short narrative of recent activity and what's coming next. Ground every sentence only in the supplied timeline/milestone data; never invent an event or date.",
  },
  patientClinicalBrief: {
    label: "Patient Clinical Brief",
    scope: "doctor",
    instructions:
      "Given a doctor's real visit history with one patient (visit count, last/next visit, conditions, allergies, medications on file, recent prescriptions, insurance and outstanding-bill status), produce a short pre-consultation brief: 2-3 sentence overview plus a short list of things to check before the visit. Never suggest a diagnosis and never invent a condition, medicine, or date not present in the supplied data.",
  },
  prescriptionFollowUpSuggestion: {
    label: "Follow-up Suggestion",
    scope: "doctor",
    instructions:
      "Given a prescription's diagnosis, medicines, and duration, plus the patient's recent visit history, suggest a reasonable follow-up window (e.g. '7-10 days' style phrasing) and what the doctor should re-check. This is a scheduling suggestion, not a clinical directive — the doctor sets the actual follow-up date. Never diagnose and never invent a medicine or condition not supplied.",
  },
  scheduleOptimization: {
    label: "Schedule Optimization",
    scope: "doctor",
    instructions:
      "Given a doctor's real per-day booked-slot counts vs configured capacity for the coming week, plus upcoming leave, suggest where to add/reduce slots or flag overbooked/underbooked days. Only reference days and numbers actually supplied; never invent a day's utilization.",
  },
  documentCenterSuggestions: {
    label: "Document Center Suggestions",
    scope: "doctor",
    instructions:
      "Given real counts of expiring/expired documents, pending verifications, and recently generated certificates/prescriptions, produce a short prioritized action list. Only surface items with a non-zero count; never invent a document.",
  },
  revenueInsights: {
    label: "Revenue Insights",
    scope: "doctor",
    instructions:
      "Given a doctor's real revenue breakdown (today/week/month/quarter/year, pending vs settled, platform fees, tax, refunds, income forecast), summarize the current financial position in plain language and flag 1-2 notable trends. Use only the supplied figures; never invent an amount or period not present in the data.",
  },
  reputationAdvisor: {
    label: "Reputation Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's real reputation metrics (rating, satisfaction rate, response rate, appointment reliability, repeat-patient rate, top strengths, improvement opportunities), give a short, encouraging assessment plus 1-2 concrete, actionable suggestions tied only to the supplied improvement opportunities. Never invent a metric not present in the data.",
  },
  businessAdvisor: {
    label: "AI Business Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's combined real business snapshot (revenue, rating, growth, retention, appointment conversion, refund rate, business score), produce a brief monthly-report-style narrative covering: performance summary, one business opportunity, one weak area, one patient-retention suggestion, and a short forecast summary. Ground every sentence in the supplied numbers only; never invent a figure or trend not present in the data.",
  },
  profileReview: {
    label: "Profile Review",
    scope: "doctor",
    instructions:
      "Given a doctor's real Professional Identity Center data (profile completion %, practice completeness %, verification progress %, SEO readiness %, trust score, missing information, missing documents), give a short honest assessment of how complete and discoverable the profile currently is, and name the single highest-impact next step. Use only the supplied figures and missing-item labels; never invent a field or score not present in the data.",
  },
  verificationAdvisor: {
    label: "Verification Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's real Verification Center data (verification status, required documents and their upload/verification state, expiring/expired documents, verification notes), explain in plain language exactly what is outstanding and what to do next. Use only the supplied document labels and statuses; never invent a document type or status not present in the data.",
  },
  subscriptionAdvisor: {
    label: "Subscription Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's real subscription usage data (current plan, and AI/patient/appointment/storage usage against that plan's real limits), point out any usage approaching or over its limit and suggest whether the current plan still fits. Use only the supplied usage figures and limits; never invent a metric or plan not present in the data.",
  },
  growthAdvisor: {
    label: "Growth Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's real Practice Analytics data (profile visits, appointment conversion rate, patient acquisition, repeat-patient rate, growth score), give a short assessment of practice growth and one concrete suggestion tied only to the weakest supplied metric. Never invent a metric, percentage, or trend not present in the data.",
  },
  missingFieldsAdvisor: {
    label: "Missing Fields Advisor",
    scope: "doctor",
    instructions:
      "Given a doctor's real list of missing profile information and missing verification documents, produce a short, prioritized checklist of what to complete next, in the order supplied. Use only the supplied missing-item labels; never invent a field or document type not present in the data.",
  },
  // ---------------------------------------------------------- Phase D5 ----
  consultationAssistant: {
    label: "AI Consultation Assistant",
    scope: "doctor",
    instructions:
      "Given a single in-progress consultation's real visit-intake data (reason, symptoms, pain level, allergies, current medications, medical conditions on file, report count, prior visit count, prior diagnoses/medicines from this doctor's own prescription history, and any rule-based safety warnings already computed) produce a structured pre-charting aid: a short clinical checklist of what to verify, a list of investigations/labs that may be worth considering given the stated symptoms, a lifestyle-guidance list, and a note on whether a specialist referral may be worth considering given the stated reason/symptoms. This NEVER states a diagnosis or a definitive treatment plan — every item is phrased as a suggestion for the doctor to confirm, and every item must trace back to a symptom, condition, allergy, or history value actually present in the supplied context. If a field is empty, omit the corresponding suggestion rather than inventing one.",
  },
  patientEducationSummary: {
    label: "Patient Education Summary",
    scope: "doctor",
    instructions:
      "Given a saved prescription's real diagnosis, medicines (name/dosage/frequency/duration/instructions), and follow-up date, draft a plain-language, patient-friendly explanation of the visit outcome and how to take each medicine, plus general self-care reminders tied only to the supplied instructions. This is a communication draft the doctor must review and share explicitly — never add dosage guidance beyond what was actually prescribed, and never invent a medicine, condition, or instruction not present in the data.",
  },
  // ---------------------------------------------------------- Phase A6.2.5 ----
  // Autonomous Workflow Intelligence & Self-Healing Platform. 6 of the
  // brief's listed 9 prompts are built; decisionExplain/confidenceExplain/
  // workflowRiskAdvisor are deliberately NOT separate prompts — every
  // decision/confidence object already carries a plain-language
  // `explanation`/`reason` array computed deterministically by
  // decisionEngine.js/confidenceEngine.js (no AI needed to explain a
  // formula), and "workflow risk" is already covered by the pre-existing
  // workflowExplain (A6.2.1). Adding near-duplicate prompts for the same
  // underlying data was avoided the same way A6.2.3 combined its own
  // Explain/Suggest/Optimize/Detect-Risk cluster into two prompts.
  predictionExplain: {
    label: "Prediction Explanation",
    scope: "admin",
    instructions:
      "Given one real prediction object (id, prediction text, confidence score, reason, supporting metrics, recommended action) produced by the Prediction Engine, explain in plain language why the platform is predicting this, which real metric(s) triggered it, and what the recommended next step accomplishes. Never invent a metric or number not present in supportingMetrics.",
  },
  anomalyExplain: {
    label: "Anomaly Explanation",
    scope: "admin",
    instructions:
      "Given one real anomaly object (metric, severity, root cause, evidence, impact, confidence, z-score) produced by the Anomaly Detector, explain in plain language what deviated from normal, how large the deviation is, and what a reasonable admin next step is. Never invent a cause not present in the supplied evidence/rootCause fields.",
  },
  capacityAdvisor: {
    label: "Capacity Advisor",
    scope: "admin",
    instructions:
      "Given the real Capacity Forecast output (per-metric 1h/24h/7d/30d projections, trend confidence r², sample sizes, and the explicitly disclosed deferredMetrics list), summarize which areas are trending toward capacity pressure and which are stable, and note any metric whose trend confidence is too low to act on. Never present a projection as certain when its own trendConfidenceR2 is low, and never fabricate a forecast for anything in deferredMetrics.",
  },
  optimizationAdvisor: {
    label: "Optimization Advisor",
    scope: "admin",
    instructions:
      "Given the real Workflow Optimization Engine output (a list of merge/disable/split/optimize/priority_tuning suggestions, each with its own real 'why'), prioritize the top few suggestions by likely impact and summarize the reasoning already supplied. Never invent a suggestion, flow name, or reason not present in the supplied suggestions list.",
  },
  selfHealingAdvisor: {
    label: "Self-Healing Advisor",
    scope: "admin",
    instructions:
      "Given the real Self-Healing queue (pending_approval/executed/failed/rejected action log entries, each with actionKey, trigger, eligibility, safetyPolicy, rollbackPossible) summarize what is awaiting approval, what already ran and its outcome, and flag anything that failed. Never recommend approving an action outside the supplied allowlist definitions, and never claim an action executed if its status is not 'executed'.",
  },
  platformIntelligenceSummary: {
    label: "Platform Intelligence Summary",
    scope: "admin",
    instructions:
      "Given the real Platform Intelligence Score and its component counts (open predictions, active anomalies, pending healing actions, optimization suggestions), produce a short executive-level summary of overall platform health and the single most urgent item to look at. Never invent a score component not present in the supplied breakdown.",
  },

  // ── Phase A6.3.1/A6.3.2 — Enterprise Process Registry & Orchestration
  // Core + Cross-System Integration Hub. The mission brief's Part 8 lists
  // 8 capabilities (processExplain, integrationExplain, dependencyExplain,
  // processAdvisor, integrationAdvisor, orchestrationAdvisor,
  // impactAnalysis, workflowTrace). Per this codebase's own established
  // convention (A6.2.3 collapsed 6 asks into 2 prompts, A6.2.5 explicitly
  // declined 3 near-duplicate prompts), these 8 are combined into 4: a
  // process's own registry entry already contains its dependencies, so
  // dependencyExplain is folded into processExplain; processAdvisor and
  // integrationAdvisor both ask for admin-level recommendations over data
  // this phase's engines already produce, so both are folded into one
  // orchestrationAdvisor; workflowTrace IS impact analysis over the same
  // dependency graph, so it is folded into impactAnalysis.
  processExplain: {
    label: "Process Explanation",
    scope: "admin",
    instructions:
      "Given one real Process Registry entry (id, category, owner, entry/exit points, dependencies, trigger events, AI/automation/monitoring/assignment usage, rollback/retry support, business/validation rules) plus its real computed health score, explain in plain language what this process does, which real processes it depends on, what its current health signal means, and what would break if it stopped working. Never invent a dependency, controller, or rule not present in the supplied registry entry.",
  },
  integrationExplain: {
    label: "Integration Explanation",
    scope: "admin",
    instructions:
      "Given one real Integration Hub edge (from/to process labels, verifiedVia registry reference, both endpoints' real health scores, edge status) explain in plain language what this integration connects, how it was discovered (from the Process Registry's own dependency data, never a static list), and what the current health status implies. Never invent a data flow or protocol not present in the supplied edge data.",
  },
  orchestrationAdvisor: {
    label: "Orchestration & Integration Advisor",
    scope: "admin",
    instructions:
      "Given the real orchestration plan and/or integration health summary supplied (execution mode, approval gates, rollback/retry support, per-edge health/status, connected vs disconnected modules), recommend the top 1-3 things an admin should look at first and why, grounded only in the supplied data. Never recommend a fix outside what the data shows, and never claim a module is disconnected or unhealthy unless the supplied data says so.",
  },
  impactAnalysis: {
    label: "Impact Analysis & Trace",
    scope: "admin",
    instructions:
      "Given one real process's upstream dependencies, downstream impacted processes (from the Process Dependency Graph), and — when supplied — a real cross-system event trace for one sourceId (automation runs, notifications, AI drafts, workflow lifecycle entries in chronological order), explain what would be impacted if this process degraded and/or narrate the real trace in plain language. Never invent a downstream process or trace event not present in the supplied graph/trace data.",
  },
  // Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
  // Two grounded capabilities covering the brief's whole Explain/Suggest
  // cluster for the new Designer (Section 16) — scoped down to explain the
  // definition itself plus explain one simulation run, since risk/impact
  // are already deterministic engines with their own plain-language
  // "reason" strings (riskEngine.js/impactAnalysis.js) and don't need a
  // separate AI prompt duplicating them.
  processDesignExplain: {
    label: "Process Design Explanation",
    scope: "admin",
    instructions:
      "Given one real Process Designer definition (name, status, version, real node list with types and configured trigger/action types, real edge list, server-computed validation result, server-computed risk level and factors), explain in plain language what this process does end to end, which real backend capabilities each node touches, and what its current validation/risk status means for whether it is safe to publish or activate. Never invent a node, action type, or capability not present in the supplied definition.",
  },
  processSimulationExplain: {
    label: "Process Simulation Explanation",
    scope: "admin",
    instructions:
      "Given one real Process Simulation Engine run (overall status, ordered node-by-node trace with each node's real PASS/SKIPPED/BLOCKED/WARNING/FAIL/UNSUPPORTED result and message), narrate what happened step by step in plain language and name the single node most responsible for the overall outcome. Never invent a node, status, or message not present in the supplied trace — this was a dry run against no production data, and the explanation must say so.",
  },
  // Phase A6.3.4 — Process Analytics & Optimization Intelligence. Four
  // grounded capabilities covering the brief's Section 15 cluster —
  // AI receives ONLY server-computed real metrics from
  // process-analytics/processAnalyticsAggregates.js and never calculates a
  // hidden number of its own. Every prompt must distinguish FACT from
  // RECOMMENDATION per the brief's own instruction.
  processAnalyticsExplain: {
    label: "Process Analytics Explanation",
    scope: "admin",
    instructions:
      "Given one real process's server-computed performance metrics (execution counts, success/failure rate, duration percentiles, SLA compliance if configured, health score and its disclosed factors) for a stated real time period, explain in plain language what is happening with this process and why it matters operationally. Clearly separate FACTS (the supplied numbers) from any RECOMMENDATION. Never invent a metric, percentage, or time period not present in the supplied data — if a field is null or marked as insufficient data, say so honestly rather than guessing.",
  },
  processBottleneckExplain: {
    label: "Process Bottleneck Explanation",
    scope: "admin",
    instructions:
      "Given one real process's server-computed bottleneck analysis (per-node execution count, failure rate, average/P95 duration, skip count, and each node's confidence level), explain in plain language which node(s) are the real bottleneck and why, citing only the supplied evidence numbers. Never call a node a bottleneck if its confidence is 'insufficient' — say plainly that there isn't enough data yet instead. Never invent a root cause not present in the supplied evidence.",
  },
  processOptimizationAdvisor: {
    label: "Process Optimization Advisor",
    scope: "admin",
    instructions:
      "Given one or more real, server-generated optimization recommendations (issue type, severity, confidence, affected node(s), the real evidence numbers behind it, and the recommended change), explain in plain language why each was flagged and what risk applies to acting on it. Explicitly label the evidence as FACT and the suggested action as RECOMMENDATION. Never state a numeric percentage improvement that is not already present in the supplied evidence — only the real observed rates supplied may be cited.",
  },
  processVersionComparisonExplain: {
    label: "Process Version Comparison Explanation",
    scope: "admin",
    instructions:
      "Given one real version-to-version comparison (two versions' real execution counts, success/failure rates, average duration, and structural node/edge changes), explain in plain language what changed and whether the newer version is performing better or worse, citing only the supplied numbers. If either version is marked as having insufficient data, say so plainly rather than drawing a conclusion from too few samples. Never invent a cause for the difference beyond the structural changes actually supplied.",
  },
  // Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
  // Intelligence. Four grounded capabilities covering the brief's Section
  // 16 cluster. Section 16 is explicit: "AI MUST NOT decide approval" —
  // every prompt here only explains server-computed governance/policy
  // decisions from processGovernanceEngine.js, and separates FACT from
  // RECOMMENDATION. The human decision (approve/reject) always remains
  // authoritative; these endpoints are read-only explain calls.
  governanceExplain: {
    label: "Governance Explanation",
    scope: "admin",
    instructions:
      "Given one real process's server-computed governance evaluation (effective risk tier, whether approval/simulation/documentation/segregation-of-duties are required, the current approval state, and the full compliance control list with each control's real PASS/FAIL/WARNING/NOT_CONFIGURED/NOT_APPLICABLE status and evidence), explain in plain language the process's overall governance posture and what — if anything — is blocking it from publishing or activating. Clearly separate FACT (the supplied controls/evidence) from RECOMMENDATION (what an admin should do next). Never invent a control, evidence string, or approval state not present in the supplied data, and never state that a process is approved or compliant unless the supplied data says so.",
  },
  approvalRiskExplain: {
    label: "Approval Risk Explanation",
    scope: "admin",
    instructions:
      "Given one real process's server-computed governance evaluation (risk tier, whether segregation of duties is required, who created it, and the current approval record), explain in plain language why this specific process does or does not require governance approval, and — if segregation of duties applies — why the creator and approver must be different people. Never recommend approving or rejecting the process yourself; only explain the real policy and evidence supplied. Never invent a policy rule not present in the supplied data.",
  },
  complianceSummary: {
    label: "Compliance Summary",
    scope: "admin",
    instructions:
      "Given one real process's full compliance control matrix (each control's name, real PASS/FAIL/WARNING/NOT_CONFIGURED/NOT_APPLICABLE status, and evidence) and its risk tier, summarize in plain language the process's compliance posture: which controls pass, which fail and why, and what evidence is missing. Clearly separate FACT (the supplied control statuses) from RECOMMENDATION (what to fix first). Never mark or describe a control as passed unless its supplied status is PASS, and never fabricate a percentage compliance score — the brief explicitly forbids arbitrary scores.",
  },
  changeImpactExplain: {
    label: "Change Impact Explanation",
    scope: "admin",
    instructions:
      "Given one real current-vs-proposed process version comparison (each version's number, status, and server-computed risk level), explain in plain language how the risk profile changes between the two versions and what that means for whether the new version should go through governance approval. Never invent a structural change, risk factor, or number not present in the supplied comparison — if you need more detail than risk level alone to explain a change, say so honestly rather than guessing.",
  },
  // PHASE UI-4 — Patients Management Workspace. Admin-facing, strictly
  // operational (not clinical judgment): summarizes a single patient's
  // real visit/financial/insurance state for an admin who needs to
  // understand and operate the account quickly. Must clearly separate
  // FACT (verbatim from the supplied aggregate) from RECOMMENDATION
  // (an operational suggestion, never a medical one) and must never
  // diagnose, invent a medication, appointment, payment, report, or date.
  patientOperationalSummary: {
    label: "Patient Operational Summary",
    scope: "admin",
    instructions:
      "Given one patient's real operational aggregate (visit count, last/next visit, outstanding balance, insurance status, unreviewed critical reports, and the deterministic attention items already computed from real data), produce a short FACT-then-RECOMMENDATION operational brief for an admin. State only facts present in the supplied aggregate — never infer a diagnosis, never invent a medication, appointment, payment amount, or date not supplied. Recommendations must be purely operational (e.g. follow up on payment, confirm insurance renewal, escalate an unreviewed report) and never a medical/clinical directive.",
  },
  // PHASE UI-7 — Finance Executive Command Center. Advisory only (Section
  // 17: AI never decides financial actions, never invents revenue,
  // payment reasons, fraud, or percentages). Every number in the supplied
  // context is already computed server-side by
  // backend/services/finance/financeAggregates.js — this prompt only
  // explains those real numbers, clearly separating FACT from
  // RECOMMENDATION, exactly like governanceExplain/complianceSummary
  // above.
  financeExecutiveSummary: {
    label: "Finance Executive Summary",
    scope: "admin",
    instructions:
      "Given the platform's real, server-computed finance overview (gross/net revenue, refunds, outstanding amount, failed payments, invoice value), its financial health score with contributing factors, and the current attention-queue counts (payments/refunds/reconciliation issues needing action), produce a short FACT-then-RECOMMENDATION executive brief a CEO could read in 5-10 seconds. State only figures present in the supplied data — never invent a revenue number, a percentage, a cause for a trend, or a fraud claim. Recommendations must point only at the real attention-queue categories supplied (e.g. 'review the N payments needing attention', 'resolve the reconciliation issues') — never a generic business-strategy suggestion unrelated to the supplied data.",
  },
  // PHASE UI-9 — Executive Admin Command Center. Distinct from the existing
  // executiveBrief (which only narrates the narrow platform-overview
  // numbers as a bullet list). This capability is fed the full cross-domain
  // command center aggregate (platform health, the real Unified Operations
  // Queue counts, finance, reputation, workflow/automation health,
  // governance — every one of them already computed server-side by an
  // existing builder, never re-derived here) and must produce the
  // structured EXECUTIVE SUMMARY / WHAT CHANGED / WHAT NEEDS ATTENTION /
  // RECOMMENDED ACTIONS / RISK-OPPORTUNITY sections the brief requires,
  // with FACT explicitly separated from RECOMMENDATION throughout. Any
  // section the caller could not access (permission-denied or a failed
  // data source) must be reported as unavailable, never silently omitted
  // or backfilled with an invented number.
  commandCenterExecutiveSummary: {
    label: "Executive Command Center Summary",
    scope: "admin",
    instructions:
      "Given the platform's real, server-computed executive command center aggregate (platform health score and breakdown, today's revenue/appointments/pending-approvals, the Unified Operations Queue's real needs-attention counts by priority, finance overview and health score if available, reputation summary and doctors needing attention if available, workflow/automation health counts if available, governance KPIs if available — each section marked available or unavailable), produce five clearly labeled sections: EXECUTIVE SUMMARY (2-3 sentences), WHAT CHANGED (only if today/growth figures are supplied), WHAT NEEDS ATTENTION (grounded only in the supplied needs-attention counts and items), RECOMMENDED ACTIONS (grounded only in the supplied attention/finance/workflow/governance counts), and RISK / OPPORTUNITY (grounded only in supplied figures). Every sentence must be labeled FACT or RECOMMENDATION. Never invent a metric, percentage, or trend not present in the supplied data. If a section is marked unavailable (data source failed or the requesting admin lacks permission for it), say so plainly rather than guessing at its content.",
  },
};

export function getPrompt(promptKey) {
  const prompt = PROMPTS[promptKey];
  if (!prompt) throw new Error(`Unknown AI prompt key: ${promptKey}`);
  return prompt;
}
