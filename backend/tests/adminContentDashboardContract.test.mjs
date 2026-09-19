import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const aggregate = read("backend/services/commandCenter/commandCenterAggregates.js");
const dashboard = read("src/pages/dashboard/AdminDashboard.jsx");

assert.match(aggregate, /Service\.countDocuments/);
assert.match(aggregate, /CMSPage\.countDocuments/);
assert.match(aggregate, /verificationStatus: "pending"/);
assert.match(aggregate, /verificationStatus: "approved"/);
assert.match(aggregate, /verificationStatus: "rejected"/);
assert.match(aggregate, /status: "published", visibility: "public", isActive: true/);
assert.match(aggregate, /contentType: "article", status: "published", visibility: "public", isPublished: true/);
assert.match(aggregate, /content: contentSection\.available/);
assert.match(dashboard, /Doctor Workflow/);
assert.match(dashboard, /Content Workflow/);
assert.match(dashboard, /item\.published/);
assert.match(dashboard, /content\.services/);
assert.match(dashboard, /content\.articles/);

console.log("admin content/dashboard contract passed");
