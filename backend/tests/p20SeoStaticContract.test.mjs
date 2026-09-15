import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const validation = read("backend/services/seoValidation.js");
assert.ok(validation.includes("missing title"));
assert.ok(validation.includes("canonical must be absolute"));
assert.ok(validation.includes("malformed JSON-LD"));

const seo = read("src/components/shared/SEOMeta.jsx");
for (const token of ["description", "og:title", "og:description", "og:url", "og:type", "og:image", "og:image:alt", "twitter:card", "twitter:title", "twitter:description", "twitter:image", "canonical", "application/ld+json"]) {
  assert.ok(seo.includes(token), `SEOMeta missing ${token}`);
}
assert.ok(seo.includes("noindex,follow"));
assert.ok(seo.includes("buildBreadcrumbJsonLd"));
assert.ok(seo.includes("buildOrganizationJsonLd"));

const app = read("backend/app.js");
assert.ok(app.includes('app.get("/robots.txt"'));
assert.ok(app.includes('app.get("/sitemap.xml"'));
assert.ok(app.includes("buildSitemapXml"));

const sitemapService = read("backend/services/seoInfrastructureService.js");
for (const token of ["Doctor.find", "Service.find", "CMSPage.find", "status: \"published\"", "visibility: \"public\"", "/doctors/", "/services/", "/articles/"]) {
  assert.ok(sitemapService.includes(token), `sitemap implementation missing ${token}`);
}
assert.ok(!fs.existsSync(path.join(root, "public/robots.txt")));
assert.ok(!fs.existsSync(path.join(root, "public/sitemap.xml")));

for (const file of ["src/pages/public/Home.jsx","src/pages/public/DoctorProfile.jsx","src/pages/public/ServiceDetail.jsx","src/pages/public/ArticleDetail.jsx"]) {
  const source = read(file);
  assert.ok(source.includes("SEOMeta"), `${file} missing SEOMeta`);
}

console.log("P20 SEO static contract: PASS");
