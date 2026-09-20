// LGD source loader — real behaviour against the committed dataset (no DB).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LgdSourceError, DEFAULT_LGD_DIR, loadLgdSource, parseDelimited } from "../master-data/lgdSource.js";

let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  PASS ${name}`); } catch (e) { failed += 1; console.error(`  FAIL ${name}\n`, e); } };
console.log("lgdSourceLoader.test.mjs");

const src = loadLgdSource({ env: {} });
const byKey = (list) => new Map(list.map((x) => [x.key, x]));
const stateByName = (n) => src.states.find((s) => s.name === n);
const districtsOf = (state) => src.districts.filter((d) => d.stateKey === state.key);
const citiesOf = (district) => src.cities.filter((c) => c.districtKey === district.key);

test("committed LGD snapshot yields the real hierarchy sizes", () => {
  assert.equal(src.stats.states, 36);
  assert.ok(src.stats.districts >= 780, `districts=${src.stats.districts}`);
  assert.ok(src.stats.cities >= 5000, `cities=${src.stats.cities}`);
  assert.equal(src.manifest.snapshotDate, "2026-09-19");
});
test("Rajasthan, Uttar Pradesh, Delhi, Maharashtra exist", () => {
  for (const n of ["Rajasthan", "Uttar Pradesh", "Delhi", "Maharashtra"]) assert.ok(stateByName(n), n);
});
test("Jaipur is a Rajasthan district, Mathura an Uttar Pradesh district (never crossed)", () => {
  const raj = districtsOf(stateByName("Rajasthan")).map((d) => d.name);
  const up = districtsOf(stateByName("Uttar Pradesh")).map((d) => d.name);
  assert.ok(raj.includes("Jaipur") && !raj.includes("Mathura"));
  assert.ok(up.includes("Mathura") && !up.includes("Jaipur"));
});
test("cities are parented by district: Jaipur city under Jaipur district only", () => {
  const jaipur = districtsOf(stateByName("Rajasthan")).find((d) => d.name === "Jaipur");
  const mathura = districtsOf(stateByName("Uttar Pradesh")).find((d) => d.name === "Mathura");
  assert.ok(citiesOf(jaipur).some((c) => c.name === "Jaipur"));
  assert.ok(!citiesOf(mathura).some((c) => c.name === "Jaipur"));
  assert.ok(citiesOf(mathura).some((c) => c.name === "Mathura"));
});
test("every district/city resolves to an existing parent; no duplicate (parent,name)", () => {
  const states = byKey(src.states); const districts = byKey(src.districts);
  assert.ok(src.districts.every((d) => states.has(d.stateKey)));
  assert.ok(src.cities.every((c) => districts.has(c.districtKey)));
  const seen = new Set();
  for (const c of src.cities) { const k = `${c.districtKey}|${c.name.toLowerCase()}`; assert.ok(!seen.has(k), k); seen.add(k); }
});
test("delimiter auto-detection: comma and semicolon exports both parse", () => {
  assert.deepEqual(parseDelimited('a,b\n1,"x,y"\n'), [{ a: "1", b: "x,y" }]);
  assert.deepEqual(parseDelimited("a;b\n1;2\n"), [{ a: "1", b: "2" }]);
});

const copyDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgd-"));
  for (const f of fs.readdirSync(DEFAULT_LGD_DIR)) fs.copyFileSync(path.join(DEFAULT_LGD_DIR, f), path.join(dir, f));
  return dir;
};
test("FAILS CLEARLY when the source directory is missing (no silent empty import)", () => {
  assert.throws(() => loadLgdSource({ env: { LGD_MASTER_DATA_DIR: path.join(os.tmpdir(), "does-not-exist-lgd") } }), LgdSourceError);
});
test("FAILS when a source file is altered (checksum mismatch)", () => {
  const dir = copyDir();
  fs.appendFileSync(path.join(dir, "states.csv"), "\n99,Fakeland\n");
  assert.throws(() => loadLgdSource({ env: { LGD_MASTER_DATA_DIR: dir } }), /checksum mismatch/);
});
test("FAILS when a source file is empty", () => {
  const dir = copyDir(); fs.writeFileSync(path.join(dir, "districts.csv"), "");
  assert.throws(() => loadLgdSource({ env: { LGD_MASTER_DATA_DIR: dir, LGD_SKIP_CHECKSUM: "1" } }), /empty/);
});
test("FAILS when a district references an unknown state", () => {
  const dir = copyDir();
  fs.appendFileSync(path.join(dir, "districts.csv"), "\n9999,Ghost District,9999,Ghost State,\n");
  assert.throws(() => loadLgdSource({ env: { LGD_MASTER_DATA_DIR: dir, LGD_SKIP_CHECKSUM: "1" } }), LgdSourceError);
});

if (failed) process.exit(1);
console.log("LGD source loader: PASS");
