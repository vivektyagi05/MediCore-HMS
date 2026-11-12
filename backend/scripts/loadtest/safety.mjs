// Load-test seeder safety gates. PURE (no I/O, no mongoose, no env.js import) so
// every rule here is unit-testable without a database. The tool never reads the
// application's MONGO_URI to connect — only to prove the target is a DIFFERENT
// database.

export const DENIED_DB_NAMES = Object.freeze([
  "admin", "local", "config", "test", "production", "prod", "staging", "stage",
  "live", "default", "hms", "medicore", "medicore-hms", "medicore_hms", "db", "database",
]);

// Must END in _loadtest / _test (or -loadtest / -test) with a real prefix: "hms_test", "medicore_loadtest".
export const DB_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*[_-](loadtest|test)$/i;
const PRODUCTIONISH = /(^|[._-])(prod|production|prd|live|staging|stage)([._-]|$)/i;

export const parseMongoTarget = (uri) => {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const m = /^(mongodb(?:\+srv)?):\/\/(.*)$/i.exec(uri.trim());
  if (!m) return null;
  const rest = m[2];
  const authEnd = rest.search(/[/?]/);
  const authority = authEnd === -1 ? rest : rest.slice(0, authEnd);
  const tail = authEnd === -1 ? "" : rest.slice(authEnd);
  const at = authority.lastIndexOf("@");
  const hostPart = at === -1 ? authority : authority.slice(at + 1);
  const hosts = hostPart.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const pathPart = tail.startsWith("/") ? tail.slice(1).split("?")[0] : "";
  let db = "";
  try { db = decodeURIComponent(pathPart); } catch { db = pathPart; }
  return { scheme: m[1].toLowerCase(), hosts, db, hasCredentials: at !== -1 };
};

// Never includes credentials, only host(s) + database.
export const describeTarget = (target) =>
  target ? `${target.hosts.join(",")}/${target.db || "(none)"}` : "(unparseable)";

const sameTarget = (a, b) =>
  a && b && a.db === b.db && [...a.hosts].sort().join(",") === [...b.hosts].sort().join(",");

/**
 * Evaluates every gate. Returns { ok, errors[], target, info[] }.
 * `write` = true for seed/cleanup writes; verify (read-only) passes write:false.
 */
export const evaluateSafety = ({ env = {}, write = false, requirePassword = write } = {}) => {
  const errors = [];
  const info = [];
  if (env.SEED_LOAD_TEST !== "1") errors.push("SEED_LOAD_TEST=1 is required (explicit opt-in).");
  if (String(env.NODE_ENV || "").toLowerCase() === "production") errors.push("NODE_ENV=production is refused.");

  const raw = env.MONGO_URI_TEST;
  let target = null;
  if (!raw || !String(raw).trim()) {
    errors.push("MONGO_URI_TEST is required (the application's MONGO_URI is never used by this tool).");
  } else {
    target = parseMongoTarget(raw);
    if (!target) errors.push("MONGO_URI_TEST is not a parseable mongodb:// or mongodb+srv:// URI.");
    else {
      if (!target.hosts.length) errors.push("MONGO_URI_TEST has no host.");
      if (!target.db) errors.push("MONGO_URI_TEST has no database name (the default database is refused).");
      else {
        const lower = target.db.toLowerCase();
        if (DENIED_DB_NAMES.includes(lower)) errors.push(`Database name "${target.db}" is on the denylist.`);
        else if (PRODUCTIONISH.test(lower)) errors.push(`Database name "${target.db}" looks production-like.`);
        else if (!DB_NAME_PATTERN.test(target.db)) errors.push(`Database name "${target.db}" must end in _loadtest or _test (e.g. medicore_loadtest).`);
      }
      const badHost = target.hosts.find((h) => PRODUCTIONISH.test(h));
      if (badHost) errors.push(`Host "${badHost}" looks production-like.`);
      const appUri = env.MONGO_URI;
      if (appUri) {
        const app = parseMongoTarget(appUri);
        if (String(appUri).trim() === String(raw).trim() || sameTarget(app, target)) {
          errors.push("MONGO_URI_TEST points at the same host and database as the configured MONGO_URI.");
        }
      } else info.push("MONGO_URI is not set; same-as-application-database check skipped.");
    }
  }
  if (requirePassword) {
    const pw = env.LOAD_TEST_PASSWORD;
    if (typeof pw !== "string" || pw.length < 12) errors.push("LOAD_TEST_PASSWORD (min 12 characters) is required for writes.");
  }
  return { ok: errors.length === 0, errors, info, target };
};
