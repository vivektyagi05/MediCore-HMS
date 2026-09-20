// LGD source loader — pure (no database, no network).
//
// Reads the committed, checksummed Local Government Directory export in
// backend/master-data/source/lgd and resolves the State → District → City
// hierarchy. It fails LOUDLY (throws) on a missing/altered source or an
// unresolvable hierarchy, so an import can never silently produce an empty
// or partial geography.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LGD_DIR = path.join(__dirname, "source", "lgd");

const FIELD_ALIASES = {
  stateName: ["State Name (In English)", "State Name(In English)", "State Name"],
  stateCode: ["State Code", "State code"],
  districtName: ["District Name(In English)", "District Name (In English)", "District Name"],
  districtCode: ["District Code", "District code"],
  cityName: ["Local Body Name (In English)", "Local Body Name\n(In English)", "Localbody Name\n(In English)", "Localbody Name", "Local Body Name"],
  cityStateName: ["State Name (In English)", "State Name(In English)", "State Name"],
  cityDistrictName: ["District Name (In English)", "District Name(In English)", "District Name"],
  cityDistrictCode: ["District Code", "District code"],
};

export class LgdSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "LgdSourceError";
  }
}

// Collapse whitespace but otherwise keep LGD's own spelling/casing verbatim.
export const cleanName = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const normalizeName = (value) => cleanName(value).toLowerCase();

const detectDelimiter = (text) => {
  const headerLine = text.split(/\r\n|\n|\r/, 1)[0] || "";
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const ch of headerLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") commas += 1;
    else if (!quoted && ch === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
};

export const parseDelimited = (input, delimiter = detectDelimiter(input)) => {
  const text = String(input).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; } else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(field); field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map((value) => String(value).trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()])));
};

const pick = (row, aliases) => {
  for (const key of aliases) {
    const value = row[key];
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
};

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const readSourceFile = (file) => {
  if (!fs.existsSync(file)) {
    throw new LgdSourceError(
      `LGD source file not found: ${file}. The importer will not run against an empty source. ` +
      "See backend/master-data/source/lgd/README.md for how to obtain/refresh the LGD export.",
    );
  }
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) throw new LgdSourceError(`LGD source file is empty: ${file}`);
  return text;
};

export const verifyManifest = (dir) => {
  const manifestPath = path.join(dir, "MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    throw new LgdSourceError(`LGD MANIFEST.json not found in ${dir}. Refusing to import an unverified source (set LGD_SKIP_CHECKSUM=1 only for a deliberately refreshed export).`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const entry of manifest.files || []) {
    const file = path.join(dir, entry.file);
    if (!fs.existsSync(file)) throw new LgdSourceError(`LGD source file listed in MANIFEST.json is missing: ${file}`);
    const actual = sha256File(file);
    if (actual !== entry.sha256) {
      throw new LgdSourceError(`LGD source checksum mismatch for ${entry.file}: expected ${entry.sha256}, got ${actual}. The file was altered or replaced; re-run scripts/updateLgdManifest.mjs after a deliberate refresh.`);
    }
  }
  return manifest;
};

export const resolveSourcePaths = (env = process.env) => {
  const dir = env.LGD_MASTER_DATA_DIR ? path.resolve(env.LGD_MASTER_DATA_DIR) : DEFAULT_LGD_DIR;
  return {
    dir,
    states: env.LGD_STATES_FILE || path.join(dir, "states.csv"),
    districts: env.LGD_DISTRICTS_FILE || path.join(dir, "districts.csv"),
    cities: env.LGD_CITY_FILE || path.join(dir, "statewise_ulbs_coverage.csv"),
  };
};

/**
 * Load and resolve the LGD hierarchy.
 * Returns { manifest, states, districts, cities, stats } where every district
 * references its state by `stateKey`, every city its district by `districtKey`.
 * Throws LgdSourceError for a missing/altered source or an unresolvable row.
 */
export const loadLgdSource = ({ env = process.env, verifyChecksums = env.LGD_SKIP_CHECKSUM !== "1" } = {}) => {
  const paths = resolveSourcePaths(env);
  const manifest = verifyChecksums ? verifyManifest(paths.dir) : null;

  const stateRows = parseDelimited(readSourceFile(paths.states));
  const districtRows = parseDelimited(readSourceFile(paths.districts));
  const cityRows = parseDelimited(readSourceFile(paths.cities));

  const states = [];
  const stateByCode = new Map();
  const stateByName = new Map();
  for (const row of stateRows) {
    const name = cleanName(pick(row, FIELD_ALIASES.stateName));
    const code = pick(row, FIELD_ALIASES.stateCode);
    if (!name || !code) throw new LgdSourceError(`LGD states file has a row without a name/code: ${JSON.stringify(row)}`);
    if (stateByCode.has(code)) continue;
    const state = { key: `s:${code}`, code, name };
    states.push(state);
    stateByCode.set(code, state);
    stateByName.set(normalizeName(name), state);
  }
  if (!states.length) throw new LgdSourceError("LGD states file produced zero states — check the delimiter/header of " + paths.states);

  const districts = [];
  const districtByCode = new Map();
  const districtByName = new Map();
  const unresolvedDistricts = [];
  for (const row of districtRows) {
    const name = cleanName(pick(row, FIELD_ALIASES.districtName));
    const code = pick(row, FIELD_ALIASES.districtCode);
    const state = stateByCode.get(pick(row, FIELD_ALIASES.stateCode)) || stateByName.get(normalizeName(pick(row, FIELD_ALIASES.stateName)));
    if (!name || !state) { unresolvedDistricts.push(row); continue; }
    const codeKey = `${state.code}:${code}`;
    if (code && districtByCode.has(codeKey)) continue;
    const nameKey = `${state.code}:${normalizeName(name)}`;
    if (districtByName.has(nameKey)) continue;
    const district = { key: `d:${state.code}:${code || normalizeName(name)}`, code, name, stateKey: state.key };
    districts.push(district);
    if (code) districtByCode.set(codeKey, district);
    districtByName.set(nameKey, district);
  }
  if (!districts.length) throw new LgdSourceError("LGD districts file produced zero districts — check the delimiter/header of " + paths.districts);
  if (unresolvedDistricts.length) {
    throw new LgdSourceError(`${unresolvedDistricts.length} LGD district row(s) reference an unknown state; first: ${JSON.stringify(unresolvedDistricts[0])}`);
  }
  const statesWithoutDistricts = states.filter((s) => !districts.some((d) => d.stateKey === s.key));
  if (statesWithoutDistricts.length) {
    throw new LgdSourceError(`LGD states with no districts: ${statesWithoutDistricts.map((s) => s.name).join(", ")}`);
  }

  const cities = [];
  const cityKeys = new Set();
  let unresolvedCities = 0;
  let unresolvedSample = null;
  for (const row of cityRows) {
    const name = cleanName(pick(row, FIELD_ALIASES.cityName));
    const state = stateByName.get(normalizeName(pick(row, FIELD_ALIASES.cityStateName)));
    const districtCode = pick(row, FIELD_ALIASES.cityDistrictCode);
    const districtName = pick(row, FIELD_ALIASES.cityDistrictName);
    const district = state
      ? (districtCode && districtByCode.get(`${state.code}:${districtCode}`)) || districtByName.get(`${state.code}:${normalizeName(districtName)}`)
      : null;
    if (!name) continue;
    if (!state || !district) {
      unresolvedCities += 1;
      unresolvedSample = unresolvedSample || row;
      continue;
    }
    const key = `${district.key}|${normalizeName(name)}`;
    if (cityKeys.has(key)) continue;
    cityKeys.add(key);
    cities.push({ name, districtKey: district.key });
  }
  if (!cities.length) throw new LgdSourceError("LGD city coverage file produced zero cities — check the delimiter/header of " + paths.cities);
  if (unresolvedCities) {
    throw new LgdSourceError(`${unresolvedCities} LGD city row(s) reference an unknown state/district; first: ${JSON.stringify(unresolvedSample)}`);
  }

  return {
    manifest,
    paths,
    states,
    districts,
    cities,
    stats: {
      stateRows: stateRows.length,
      districtRows: districtRows.length,
      cityRows: cityRows.length,
      states: states.length,
      districts: districts.length,
      cities: cities.length,
    },
  };
};
