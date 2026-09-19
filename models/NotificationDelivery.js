import mongoose from "mongoose";

const notificationDeliverySchema = new mongoose.Schema(
  {
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    type: {
      type: String,
      enum: [
        "appointment",
        "payment",
        "refund",
        "prescription",
        "admin_announcement",
        "chat",
        "dashboard_sync",
        // Phase D5 additions — additive only, existing values/behaviour unchanged
        "report",
        "insurance",
        // Bug-fix (process governance hardening pass) — workflowEvents.js has
        // been emitting these since Phase A6.2.1's event bus was built, but
        // the enum was never updated to match, so every workflow assignment/
        // escalation notification was silently failing NotificationDelivery
        // validation. No existing category fits an internal operations
        // hand-off notice, so these are genuinely new types, additive only.
        "workflow_assigned",
        "workflow_escalated",
        // Same bug, found by auditing every other notificationEmitter call
        // site for the identical enum-mismatch pattern. Each of these has
        // been silently failing validation since the phase that added it;
        // none fit an existing category (checked each call site's context).
        "automation", // Automation Studio no-code notify_user/notify_role/notify_admins actions
        "reminder", // Automation Studio no-code "send reminder now" action
        "schedule", // doctor leave-request status change (clinicalEmitter.js)
        "document", // doctor verification document status (clinicalEmitter.js)
        "doctor_verification", // doctor verification approved/rejected/pending (practiceEmitter.js)
        "subscription_update", // doctor subscription status change (practiceEmitter.js)
        "invoice_generated", // new practice-management invoice (practiceEmitter.js)
        "subscription_renewal_reminder", // upcoming subscription renewal (practiceEmitter.js)
        // Phase DOC-02 (Smart Inbox) additions — additive only, existing
        // values/behaviour unchanged. Two producers (patientWorkflowController's
        // review-submitted-to-doctor notice, financeController's payout-settled
        // notice) were previously mis-typed as "appointment" even though their
        // entityType already correctly said "review"/"payout" — that made Smart
        // Inbox's category grouping wrong for those two notifications. Server-side
        // categorization now prefers entityType (so historical rows already in the
        // DB categorize correctly with zero migration needed), and these two
        // dedicated types are added so newly-created rows are correctly typed too.
        "review",
        "payout",
        // Phase DOC-06 — patient-facing certificate notice (clinicalEmitter.js).
        // No existing category fits a doctor-issued certificate (fitness /
        // sick-leave / referral letter); genuinely new, additive only.
        "certificate",
        // Phase 17 — public Contact Lead notification delivered through the
        // existing NotificationDelivery + Socket.IO pipeline.
        "lead",
        "user_registered",
        "doctor_application",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    severity: { type: String, enum: ["info", "success", "warning", "critical"], default: "info", index: true },
    deliveredAt: Date,
    readAt: Date,
    eventKey: { type: String, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

notificationDeliverySchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
notificationDeliverySchema.index({ eventKey: 1, recipientId: 1 }, { unique: true, sparse: true });

const NotificationDelivery = mongoose.model("NotificationDelivery", notificationDeliverySchema);

export default NotificationDelivery;
