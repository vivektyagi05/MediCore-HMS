// N-023: configuration preflight. Run BEFORE the release/migration step and
// before starting a service:   node scripts/preflight.mjs
//
// Validates the environment with the same production guards the server uses at
// boot (so a bad deploy fails here, in the release phase, with every problem
// listed at once) plus a few operational checks. It NEVER prints secret values:
// only variable names and the reason they are rejected.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import {
  readServiceRole,
  resolveServiceRole,
  shouldRunScheduler,
  validateCommonConfig,
  validateProductionConfig,
} from "../config/productionGuards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runPreflight(source, { checkFilesystem = true } = {}) {
  const problems = [];
  const warnings = [];
  const production = String(source.NODE_ENV || "").trim().toLowerCase() === "production";

  for (const key of ["MONGO_URI", "JWT_SECRET"]) {
    if (!String(source[key] ?? "").trim()) problems.push(`${key} is required`);
  }
  problems.push(...(production ? validateProductionConfig(source) : validateCommonConfig(source)));

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) problems.push(`Node ${process.versions.node} is below the supported minimum (22.12.0, see package.json engines)`);

  const role = resolveServiceRole(source);
  if (production && readServiceRole(source) === "all" && shouldRunScheduler(source)) {
    warnings.push("SERVICE_ROLE=all runs the scheduler in every replica of this service; safe (lease-locked) but prefer one dedicated SERVICE_ROLE=worker");
  }
  if (production && role === "web") {
    warnings.push("SERVICE_ROLE=web: confirm exactly one SERVICE_ROLE=worker service is deployed, otherwise no financial job ever runs");
  }

  if (checkFilesystem && String(source.STORAGE_DRIVER || "local").toLowerCase() === "local") {
    const root = source.STORAGE_LOCAL_ROOT ? path.resolve(source.STORAGE_LOCAL_ROOT) : path.resolve(__dirname, "../storage");
    try {
      fs.mkdirSync(root, { recursive: true });
      const probe = path.join(root, `.preflight-${process.pid}`);
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
    } catch (error) {
      problems.push(`storage root ${root} is not writable (${error.code || error.message})`);
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

if (process.argv[1]?.endsWith("preflight.mjs")) {
  dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });
  const result = runPreflight(process.env);
  for (const w of result.warnings) console.warn(`preflight WARN: ${w}`);
  if (!result.ok) {
    console.error(`preflight FAILED (${result.problems.length} problem(s)):`);
    for (const p of result.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("preflight OK");
}
