import assert from "node:assert/strict";
import { validateSeoMetadata } from "../services/seoValidation.js";

assert.equal(validateSeoMetadata({
  title: "MediCore",
  canonical: "https://medicore.example/",
  robots: "index,follow",
  jsonLd: { "@type": "WebSite" },
}).valid, true);

assert.ok(validateSeoMetadata({ title: "", canonical: "/relative" }).errors.includes("missing title"));
assert.ok(validateSeoMetadata({ title: "X", canonical: "/relative" }).errors.includes("canonical must be absolute"));
assert.ok(validateSeoMetadata({ title: "X", jsonLd: "{" }).errors.includes("malformed JSON-LD"));
assert.ok(validateSeoMetadata({ title: "X", robots: "index,follow", indexable: false }).errors.includes("indexability contradiction"));

console.log("P20 SEO validation contract: PASS");
