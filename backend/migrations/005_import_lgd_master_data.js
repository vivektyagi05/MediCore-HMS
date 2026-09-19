import fs from "fs";
import path from "path";
import { connectDB, disconnectDB } from "../config/db.js";
import MasterData from "../models/MasterData.js";
import { CANONICAL_MASTER_SEEDS } from "../master-data/canonicalSeed.js";
import { normalizeMasterText } from "../utils/masterDataValidation.js";

const SOURCE_DIR = process.env.LGD_MASTER_DATA_DIR || path.resolve(process.cwd(), "master-data/source/lgd");
const STATE_FILE = process.env.LGD_STATES_FILE || path.join(SOURCE_DIR, "states.csv");
const DISTRICT_FILE = process.env.LGD_DISTRICTS_FILE || path.join(SOURCE_DIR, "districts.csv");
const CITY_FILE = process.env.LGD_CITY_FILE || path.join(SOURCE_DIR, "statewise_ulbs_coverage.csv");

const FIELD_ALIASES = {
  stateName: ["State Name(In English)", "State Name (In English)", "State Name"],
  stateCode: ["State Code", "State code"],
  districtName: ["District Name(In English)", "District Name (In English)", "District Name"],
  districtCode: ["District Code", "District code"],
  cityName: ["Localbody Name", "Local Body Name\n(In English)", "Localbody Name\n(In English)", "Local Body Name (In English)"],
  cityCode: ["Localbody", "Local Body\nCode", "Localbody Code"],
  cityDistrict: ["District Name", "District Name(In English)", "District Name (In English)"],
  cityState: ["State Name", "State Name(In English)", "State Name (In English)"],
};

const clean = (value) => normalizeMasterText(String(value || "").replace(/\s+/g, " ").trim());
const normalized = (value) => clean(value).toLowerCase();

const parseCsv = (filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`LGD source file not found: ${filePath}`);
  const input = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === ";") {
      row.push(field); field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => String(value).trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()])));
};

const first = (row, aliases) => aliases.map((key) => row[key]).find((value) => value !== undefined && String(value).trim() !== "") || "";

const upsertMaster = async ({ kind, name, parentId, source = "lgd" }) => {
  const normalizedName = normalized(name);
  if (!normalizedName) return null;
  return MasterData.findOneAndUpdate(
    { kind, parentId: parentId || null, normalizedName },
    { $set: { name: clean(name), active: true, source }, $setOnInsert: { normalizedName } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
};

const seedSpecializations = async () => {
  for (const item of CANONICAL_MASTER_SEEDS) {
    await upsertMaster({ kind: item.kind, name: item.name, parentId: null, source: "seed" });
  }
};

export const importLgdMasterData = async () => {
  await seedSpecializations();

  const states = parseCsv(STATE_FILE);
  const districts = parseCsv(DISTRICT_FILE);
  const cities = parseCsv(CITY_FILE);

  const stateByCode = new Map();
  const stateByName = new Map();
  const districtByCode = new Map();
  const districtByName = new Map();

  for (const row of states) {
    const name = first(row, FIELD_ALIASES.stateName);
    const code = first(row, FIELD_ALIASES.stateCode);
    if (!name) continue;
    const state = await upsertMaster({ kind: "state", name, parentId: null });
    stateByName.set(normalized(name), state);
    if (code) stateByCode.set(String(code).trim(), state);
  }

  for (const row of districts) {
    const name = first(row, FIELD_ALIASES.districtName);
    const stateCode = first(row, FIELD_ALIASES.stateCode);
    const stateName = first(row, FIELD_ALIASES.stateName);
    const state = stateByCode.get(String(stateCode).trim()) || stateByName.get(normalized(stateName));
    if (!name || !state) continue;
    const district = await upsertMaster({ kind: "district", name, parentId: state._id });
    const code = first(row, FIELD_ALIASES.districtCode);
    if (code) districtByCode.set(`${String(state._id)}:${String(code).trim()}`, district);
    districtByName.set(`${String(state._id)}:${normalized(name)}`, district);
  }

  const cityKeys = new Set();
  for (const row of cities) {
    const name = first(row, FIELD_ALIASES.cityName);
    const stateName = first(row, FIELD_ALIASES.cityState);
    const districtName = first(row, FIELD_ALIASES.cityDistrict);
    const state = stateByName.get(normalized(stateName));
    if (!name || !state || !districtName) continue;
    const district = districtByName.get(`${String(state._id)}:${normalized(districtName)}`);
    if (!district) continue;
    const key = `${String(district._id)}:${normalized(name)}`;
    if (cityKeys.has(key)) continue;
    cityKeys.add(key);
    await upsertMaster({ kind: "city", name, parentId: district._id });
  }

  const counts = {
    specializations: await MasterData.countDocuments({ kind: "specialization", active: true }),
    states: await MasterData.countDocuments({ kind: "state", active: true }),
    districts: await MasterData.countDocuments({ kind: "district", active: true }),
    cities: await MasterData.countDocuments({ kind: "city", active: true }),
  };

  if (!counts.states || !counts.districts || !counts.cities) {
    throw new Error(`LGD import incomplete: ${JSON.stringify(counts)}`);
  }

  return counts;
};

const run = async () => {
  await connectDB();
  const result = await importLgdMasterData();
  console.log(JSON.stringify({ source: "Government of India Local Government Directory (LGD)", sourceDirectory: SOURCE_DIR, result }));
};

if (process.argv[1]?.endsWith("005_import_lgd_master_data.js")) {
  run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => disconnectDB());
}
