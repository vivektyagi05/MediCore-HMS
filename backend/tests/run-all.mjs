import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (files.length === 0) {
  console.error("No test files found in tests/");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const failures = [];

for (const file of files) {
  const fullPath = path.join(__dirname, file);
  const result = spawnSync(process.execPath, [fullPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      // These tests are deliberately dependency-free (no live DB required).
      // Harmless dummy values so config/env.js's required-var check passes
      // for any test that happens to import it transitively.
      MONGO_URI: process.env.MONGO_URI || "mongodb://localhost:27017/hms_test",
      JWT_SECRET: process.env.JWT_SECRET || "test_secret_for_ci_only_not_real_do_not_use",
      NODE_ENV: process.env.NODE_ENV || "test",
    },
  });

  if (result.status === 0) {
    pass += 1;
    console.log(`PASS  ${file}`);
  } else {
    fail += 1;
    failures.push(file);
    console.log(`FAIL  ${file}`);
    console.log(result.stdout);
    console.error(result.stderr);
  }
}

console.log("");
console.log(`${pass} passed, ${fail} failed (${files.length} total)`);

if (fail > 0) {
  console.log("Failed files:", failures.join(", "));
  process.exit(1);
}
