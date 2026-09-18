const backend = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const frontend = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

if (!backend) {
  console.error("BACKEND_URL is required, e.g. https://api.example.com");
  process.exit(1);
}

const checks = [
  { name: "backend health", url: `${backend}/api/health`, expect: "json" },
  { name: "public stats", url: `${backend}/api/public/stats`, expect: "json" },
  { name: "public specialties", url: `${backend}/api/public/specialties`, expect: "json" },
];

if (frontend) checks.push({ name: "frontend SPA", url: `${frontend}/forgot-password`, expect: "html" });

let failed = 0;
for (const check of checks) {
  try {
    const response = await fetch(check.url, { signal: AbortSignal.timeout(15_000) });
    const body = check.expect === "json" ? await response.json() : await response.text();
    const ok = response.ok && (check.expect !== "json" || body?.success === true);
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: HTTP ${response.status}`);
    if (!ok) {
      console.log(JSON.stringify(body).slice(0, 600));
      failed += 1;
    }
  } catch (error) {
    console.log(`FAIL ${check.name}: ${error?.message || error}`);
    failed += 1;
  }
}

if (failed) process.exit(1);
console.log("Production smoke checks passed.");
