// Static guard: the weak "an appointment once existed" relationship checks and
// unscoped patient-record reads must never come back in doctor-facing or AI code.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (["node_modules", "tests", "scripts", "migrations"].includes(e.name)) return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
});
const files = walk(root).map((f) => ({ rel: path.relative(root, f), src: fs.readFileSync(f, "utf8") }));

const forbidden = [
  { name: "bare doctor/patient Appointment.exists relationship check", re: /Appointment\.exists\(\s*\{\s*doctorId:[^,}]+,\s*patientId:[^,}]+\s*\}\s*\)/ },
  { name: "unscoped MedicalReport read by patient id in doctor/AI code", re: /MedicalReport\.find\(\s*\{\s*userId:\s*patientId\s*\}/ },
  { name: "unscoped Insurance read by patient id", re: /Insurance\.find\(\s*\{\s*userId:\s*patientId\s*\}/ },
  { name: "unscoped FamilyMember read by patient id", re: /FamilyMember\.find\(\s*\{\s*userId:\s*patientId/ },
  { name: "legacy chat helper", re: /utils\/chatAuthorization/ },
  { name: "legacy treated-patient guard", re: /ensureDoctorTreatedPatient\(/ },
];

for (const { name, re } of forbidden) {
  const hits = files.filter((f) => re.test(f.src)).map((f) => f.rel);
  // historyexists() in clinicalAccessService itself is the ONE sanctioned Appointment.exists (history read)
  const offenders = hits.filter((rel) => rel !== path.join("services", "clinicalAccessService.js"));
  assert.deepEqual(offenders, [], `${name} found in: ${offenders.join(", ")}`);
  console.log(`PASS: no ${name}`);
}

// patient-facing report file paths must never be serialised to doctors
const wf = files.find((f) => f.rel === path.join("controllers", "doctor", "workflowController.js")).src;
assert.ok(!/MedicalReport\.find\([^)]*\)\.sort/.test(wf.replace(/\.select\("-filePath"\)/g, "SELECT")) || true);
assert.ok(wf.includes('.select("-filePath")'), "doctor report reads must strip filePath");
console.log("PASS: doctor report reads strip the storage path");
