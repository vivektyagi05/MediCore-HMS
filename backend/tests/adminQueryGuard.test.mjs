import assert from "assert";
import fs from "fs";
import { rejectRepeatedQuery } from "../middleware/rejectRepeatedQuery.js";

const run = (query) => { let out = "next"; rejectRepeatedQuery({ query }, {}, (e) => { out = e ? e.statusCode : "next"; }); return out; };
assert.strictEqual(run({}), "next");
assert.strictEqual(run({ a: "1", page: "2", empty: "" }), "next");
assert.strictEqual(run({ a: ["1", "2"] }), 400, "repeated key");
assert.strictEqual(run({ "a[]": ["1"] }), 400);
assert.strictEqual(run({ a: { $ne: "x" } }), 400, "object value");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const guard = app.indexOf('app.use("/api/admin", rejectRepeatedQuery)');
assert(guard > 0, "guard mounted");
for (const m of app.matchAll(/app\.use\("\/api\/admin\/[^"]+"/g)) assert(guard < m.index, `${m[0]} is mounted after the guard`);
console.log("PASS: admin query guard rejects repeated/object params and is mounted before every /api/admin route");
