// Plan resolution: turns CLI/env options into one immutable, validated plan.
// PURE — safe to call (and unit test) without a database.
export const DEFAULT_COUNTS = Object.freeze({ doctors: 10000, patients: 10000, admins: 50 });
export const MAX_ROLE_COUNT = 999999;

// Profiles change ONLY related-record volume. Role counts stay at DEFAULT_COUNTS.
export const PROFILES = Object.freeze({
  smoke: { apptPerDoctor: 2, savedPerPatient: 1, adminLogsPerAdmin: 5, cronLogs: 20, automationLogs: 40 },
  standard: { apptPerDoctor: 6, savedPerPatient: 2, adminLogsPerAdmin: 40, cronLogs: 400, automationLogs: 1000 },
  large: { apptPerDoctor: 20, savedPerPatient: 3, adminLogsPerAdmin: 200, cronLogs: 2000, automationLogs: 5000 },
});

export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
export const DEFAULT_RUN_ID = "loadtest";
export const DEFAULT_SEED = "medicore-loadtest-v1";
export const DEFAULT_BATCH_SIZE = 1000;

export const DAY_MS = 86400000;
export const PAST_DAYS = 150;
export const FUTURE_DAYS = 28; // stays inside the default 30-day booking window
export const SLOT_LABELS = Object.freeze(
  Array.from({ length: 10 }, (_, k) => {
    const s = 540 + k * 30;
    const f = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return `${f(s)}-${f(s + 30)}`;
  }),
);

const toInt = (v, name, { min = 0, max = Infinity } = {}) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer between ${min} and ${max}`);
  return n;
};

export const parseAnchor = (value, now = new Date()) => {
  if (value === undefined || value === null || value === "") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error("--anchor-date must be YYYY-MM-DD");
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error("--anchor-date is not a valid date");
  return d;
};

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
export const coprimeStep = (n, start) => { if (n <= 1) return 1; let s = start; while (gcd(s, n) !== 1) s += 1; return s; };

export const poolSizeOf = (doctors) => Math.floor(doctors / 100) * 65 + Math.min(doctors % 100, 65);

export const resolvePlan = (opts = {}, now = new Date()) => {
  const profileName = opts.profile || "standard";
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`--profile must be one of: ${Object.keys(PROFILES).join(", ")}`);
  const runId = opts.runId || DEFAULT_RUN_ID;
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("--run-id must be 3-32 chars of a-z, 0-9 and '-' (no leading/trailing '-')");
  const doctors = toInt(opts.doctors, "doctors", { min: 1, max: MAX_ROLE_COUNT }) ?? DEFAULT_COUNTS.doctors;
  const patients = toInt(opts.patients, "patients", { min: 1, max: MAX_ROLE_COUNT }) ?? DEFAULT_COUNTS.patients;
  const admins = toInt(opts.admins, "admins", { min: 1, max: MAX_ROLE_COUNT }) ?? DEFAULT_COUNTS.admins;
  const scale = opts.scale === undefined || opts.scale === null || opts.scale === "" ? 1 : Number(opts.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) throw new Error("--scale must be a number > 0 and <= 100");
  const batchSize = toInt(opts.batchSize, "batch-size", { min: 10, max: 10000 }) ?? DEFAULT_BATCH_SIZE;
  const pool = poolSizeOf(doctors);
  const appointments = pool === 0 ? 0 : Math.round(pool * profile.apptPerDoctor * scale);
  const scaled = (n) => Math.max(1, Math.round(n * scale));
  return Object.freeze({
    runId, ns: runId, domain: `${runId}.medicore.test`,
    seed: String(opts.seed ?? DEFAULT_SEED),
    profile: profileName, scale, batchSize,
    doctors, patients, admins, pool, appointments,
    savedPerPatient: profile.savedPerPatient,
    adminLogs: scaled(profile.adminLogsPerAdmin * admins),
    cronLogs: scaled(profile.cronLogs),
    automationLogs: scaled(profile.automationLogs),
    anchor: parseAnchor(opts.anchorDate, now),
    platformFeePercent: 10, taxRatePercent: 18,
  });
};
