import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const serviceModel = read("models/Service.js");
const articleModel = read("models/CMSPage.js");
const serviceAdmin = read("controllers/admin/serviceAdminController.js");
const cmsAdmin = read("controllers/admin/cmsAdminController.js");
const publicController = read("controllers/publicController.js");
const publicRoutes = read("routes/publicRoutes.js");

const checks = [
  ["Service lifecycle exists", /enum:\s*\["draft", "review", "published", "archived"\]/.test(serviceModel)],
  ["Service slug is unique", /slug:[\s\S]*unique:\s*true/.test(serviceModel)],
  ["Article lifecycle exists", /enum:\s*\["draft", "review", "published", "archived"\]/.test(articleModel)],
  ["Article content remains in CMSPage", /mongoose\.model\("CMSPage"/.test(articleModel)],
  ["Service admin uses explicit payload builder", /const buildPayload/.test(serviceAdmin)],
  ["Service admin does not mass assign request body", !/Service\.create\(\s*req\.body/.test(serviceAdmin) && !/findByIdAndUpdate\([^\n]*req\.body/.test(serviceAdmin)],
  ["CMS admin uses explicit payload builder", /const buildPayload/.test(cmsAdmin)],
  ["CMS admin does not mass assign request body", !/CMSPage\.create\(\s*req\.body/.test(cmsAdmin) && !/findByIdAndUpdate\([^\n]*req\.body/.test(cmsAdmin)],
  ["Public service detail exists", /export const getPublicServiceBySlug/.test(publicController)],
  ["Public article detail exists", /export const getPublicArticleBySlug/.test(publicController)],
  ["Public service lifecycle filter exists", /publishedServiceFilter/.test(publicController)],
  ["Public article lifecycle filter exists", /publishedArticleFilter/.test(publicController)],
  ["Service public route exists", /\/services\/:slug/.test(publicRoutes)],
  ["Article category route exists", /\/articles\/categories/.test(publicRoutes)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed += 1; }
assert.equal(failed, 0, `${failed} P19 contract checks failed`);
