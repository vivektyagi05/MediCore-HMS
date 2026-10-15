// N-001: the production index inventory.
//
// Production runs mongoose with autoIndex:false (config/db.js), so a schema's
// index declarations guarantee NOTHING about what exists in the database. This
// module turns every declaration into an explicit, comparable spec so the
// migration (011_ensure_production_indexes.js) can create, compare and verify
// them, and so a test can prove the inventory is complete.
//
// The inventory is DERIVED from the Mongoose schemas (Model.schema.indexes()),
// not hand-maintained: a hand-written list silently rots, a derived one cannot
// miss an index someone adds tomorrow. What IS hand-written is only the
// human-readable invariant behind the correctness-bearing indexes.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../models");

/** Imports every models/*.js so mongoose.models is complete. */
export async function loadAllModels() {
  const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".js")).sort();
  for (const file of files) {
    await import(pathToFileURL(path.join(MODELS_DIR, file)).href);
  }
  return mongoose.models;
}

/** The server's default index name for a key pattern: field_1_other_-1 */
export const defaultIndexName = (key) =>
  Object.entries(key).map(([field, dir]) => `${field}_${dir}`).join("_");

const OPTION_KEYS = ["unique", "sparse", "partialFilterExpression", "expireAfterSeconds", "collation", "default_language", "language_override", "weights"];

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
export const stableStringify = stable;

const isTextKey = (key) => Object.values(key).includes("text");

/** The subset of options that define index behaviour (name/background/v excluded). */
export function normalizeOptions(options = {}, { isText = false } = {}) {
  const out = {};
  for (const k of OPTION_KEYS) {
    if (options[k] === undefined) continue;
    // Text-index weights/language are server-defaulted; only compare when declared.
    if (isText && (k === "weights" || k === "default_language" || k === "language_override") && options[k] === undefined) continue;
    out[k] = options[k];
  }
  if (out.unique === false) delete out.unique;
  if (out.sparse === false) delete out.sparse;
  return out;
}

/** What each correctness-bearing named index protects (shown in reports). */
export const INVARIANTS = Object.freeze({
  uniq_cronrun_running_per_job: "scheduler lock: at most one running CronRunLog row per job (N-002)",
  uniq_invoice_payment: "one invoice per payment (F-008)",
  uniq_ledger_idempotency_key: "ledger entries are idempotent per key (no double wallet credit/debit)",
  uniq_subscription_idempotency_key: "subscription activations are idempotent per key",
  uniq_withdrawal_idempotency_key: "withdrawal requests are idempotent per key (no double payout)",
  uniq_notification_event_recipient: "one notification per (eventKey, recipient)",
  uniq_reminderlog_event_key: "one reminder per eventKey",
  uniq_appointment_booking_request: "appointment bookings are idempotent per bookingRequestId",
  uniq_service_slug: "service slugs are unique",
});

/**
 * Builds the full inventory from the registered mongoose models.
 * @returns {Array<{model,collection,name,key,options,unique,text,invariant}>}
 */
export function buildInventory(models = mongoose.models) {
  const specs = [];
  for (const [modelName, model] of Object.entries(models)) {
    for (const [key, rawOptions] of model.schema.indexes()) {
      const text = isTextKey(key);
      const name = rawOptions?.name || defaultIndexName(key);
      const options = normalizeOptions(rawOptions, { isText: text });
      specs.push({
        model: modelName,
        collection: model.collection.name,
        name,
        key,
        options,
        unique: options.unique === true,
        text,
        invariant: INVARIANTS[name] || (options.unique ? "uniqueness constraint declared on the schema" : null),
      });
    }
  }
  return specs;
}

/** Problems in the inventory itself (independent of any database). */
export function lintInventory(specs) {
  const problems = [];
  const seen = new Map();
  for (const spec of specs) {
    const id = `${spec.collection}::${spec.name}`;
    if (seen.has(id)) {
      problems.push(`duplicate index NAME ${spec.name} on ${spec.collection}: declared by ${seen.get(id)} and ${spec.model} (the server would reject the second)`);
    } else {
      seen.set(id, spec.model);
    }
    if (spec.unique && spec.options.sparse && !spec.options.partialFilterExpression) {
      problems.push(`${spec.collection}.${spec.name} is unique+sparse without a partial filter (indexes explicit nulls; prefer partial $type)`);
    }
  }
  return problems;
}

/** Indexes whose absence breaks a correctness guarantee (all unique ones). */
export const criticalSpecs = (specs) => specs.filter((s) => s.unique);
