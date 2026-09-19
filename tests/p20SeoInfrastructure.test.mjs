import assert from "node:assert/strict";
import { buildRobotsTxt } from "../services/seoInfrastructureService.js";

const robots = buildRobotsTxt("https://medicore.example");

assert.match(robots, /User-agent: \*/);
for (const route of ["/admin/", "/doctor/", "/patient/", "/api/", "/login", "/register"]) {
  assert.match(robots, new RegExp(`Disallow: ${route.replace("/", "\\/")}`));
}
assert.match(robots, /Allow: \//);
assert.match(robots, /Sitemap: https:\/\/medicore\.example\/sitemap\.xml/);

const local = buildRobotsTxt("");
assert.ok(!local.includes("localhost"));
assert.ok(!local.includes("127.0.0.1"));

console.log("P20 SEO infrastructure contract: PASS");
