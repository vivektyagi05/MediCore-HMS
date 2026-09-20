// Recompute row counts + SHA-256 in master-data/source/lgd/MANIFEST.json after a
// deliberate LGD snapshot refresh. Edit snapshotDate/downloadedAt/sourceUrl by hand.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDelimited } from "../master-data/lgdSource.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "master-data", "source", "lgd");
const manifestPath = path.join(dir, "MANIFEST.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const entry of manifest.files) {
  const file = path.join(dir, entry.file);
  entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  entry.dataRows = parseDelimited(fs.readFileSync(file, "utf8")).length;
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Updated", manifestPath);
