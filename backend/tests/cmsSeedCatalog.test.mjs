import assert from "node:assert/strict";
import fs from "node:fs";
const seed = fs.readFileSync(new URL("../seed.js", import.meta.url), "utf8");
const services = ["General Physician Consultation", "Cardiology Consultation", "Dermatology Consultation", "Pediatric Consultation", "Preventive Health Checkup", "Diagnostic Report Review"];
const articles = ["When Should You See a General Physician?", "Understanding Blood Pressure and When to Seek Care", "How to Prepare for a Doctor Consultation", "Warning Signs That Require Urgent Medical Attention", "Preventive Health Checkups: What They Usually Include", "Understanding Your Basic Blood Test Report"];
for (const t of [...services, ...articles]) assert.ok(seed.includes(`title: "${t}"`), t);
assert.equal((seed.match(/status: "published", visibility: "public"/g) || []).length, 12);
// Deterministic, non-destructive upsert: manually edited production content is never overwritten.
assert.equal((seed.match(/\$setOnInsert: \{ \.\.\.service/g) || []).length, 1);
assert.equal((seed.match(/\$setOnInsert: \{ \.\.\.article/g) || []).length, 1);
assert.match(seed, /Service\.findOneAndUpdate\(\s*\{ slug: service\.slug \}/);
assert.match(seed, /CMSPage\.findOneAndUpdate\(\s*\{ slug: article\.slug \}/);
// Articles carry references and an explicit educational (non-personalised) disclaimer; no invented statistics.
assert.equal((seed.match(/references: \[/g) || []).length, 6);
assert.equal((seed.match(/<strong>Important:<\/strong>/g) || []).length, 6);
assert.doesNotMatch(seed, /\d+(\.\d+)?\s?%/);
console.log("CMS seed catalog (6 services, 6 articles, idempotent, referenced, no statistics): PASS");
