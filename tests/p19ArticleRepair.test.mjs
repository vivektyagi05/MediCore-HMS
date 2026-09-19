import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const controller = read("controllers/admin/cmsAdminController.js");
const routes = read("routes/admin/cmsAdminRoutes.js");
const model = read("models/CMSPage.js");
const helpers = read("services/contentHelpers.js");
const serializer = read("services/articlePublicSerializer.js");
const editor = fs.readFileSync(new URL("../../src/components/cms/RichTextEditor.jsx", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../../src/pages/admin/AdminArticles.jsx", import.meta.url), "utf8");
const detail = fs.readFileSync(new URL("../../src/pages/public/ArticleDetail.jsx", import.meta.url), "utf8");

const checks = [
  ["CMSPage has publication actor fields", /publishedBy:[\s\S]*archivedBy:/.test(model)],
  ["Publish persists public state", /payload\.publishedBy = actorId/.test(controller) && /payload\.isPublished = true/.test(controller)],
  ["Archive persists private state", /payload\.archivedBy = actorId/.test(controller) && /payload\.isPublished = false/.test(controller)],
  ["Published deletion is guarded", /Published articles must be archived before deletion/.test(controller)],
  ["Banner upload endpoint exists", /router\.post\("\/banner"/.test(routes) && /uploadCMSBanner/.test(controller)],
  ["Admin uses canonical RichTextEditor", /import RichTextEditor/.test(admin)],
  ["Preview uses actual i18n locale", /const \{ t, locale \}/.test(admin) && /previewCMSPage\(a\._id,locale\)/.test(admin)],
  ["Review transition exists", /mutate\("review",a\)/.test(admin)],
  ["Delete is confirmed and persisted", /deleteConfirm/.test(admin) && /deleteCMSPage\(a\._id\)/.test(admin)],
  ["Public article content is sanitized before serialization", /sanitizePlainContent/.test(serializer)],
  ["Public article renders canonical sanitized content", /dangerouslySetInnerHTML=\{\{__html:a\.content/.test(detail)],
  ["Sanitizer strips dangerous primitives", /script|style|iframe|object|embed/.test(helpers) && /javascript|vbscript|data/.test(helpers)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed += 1; }
assert.equal(failed, 0, `${failed} P19 article repair checks failed`);
