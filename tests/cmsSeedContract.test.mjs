import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const seed = read("backend/seed.js");
const cms = read("backend/models/CMSPage.js");
const serializer = read("backend/services/articlePublicSerializer.js");
const publicController = read("backend/controllers/publicController.js");
const serviceModel = read("backend/models/Service.js");

const serviceMatches = seed.match(/slug: "[^"]+", shortDescription:/g) || [];
const articleMatches = seed.match(/slug: "[^"]+", title:/g) || [];
assert.ok(serviceMatches.length >= 6, `expected at least 6 seeded services, found ${serviceMatches.length}`);
assert.ok(articleMatches.length >= 6, `expected at least 6 seeded articles, found ${articleMatches.length}`);
assert.match(seed, /findOneAndUpdate\(\n        \{ slug: service\.slug \}/);
assert.match(seed, /findOneAndUpdate\(\n        \{ slug: article\.slug \}/);
assert.match(cms, /references:/);
assert.match(serializer, /references:/);
assert.match(publicController, /publishedArticleFilter/);
assert.match(publicController, /publishedServiceFilter/);
assert.match(serviceModel, /status: \{ type: String, enum: \["draft", "review", "published", "archived"\]/);

console.log("CMS seed contract passed");
