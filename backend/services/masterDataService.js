import mongoose from "mongoose";
import Doctor from "../models/Doctor.js";
import MasterData from "../models/MasterData.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { normalizeMasterText, validateOtherValue, assertMasterParent } from "../utils/masterDataValidation.js";
import { CANONICAL_MASTER_SEEDS } from "../master-data/canonicalSeed.js";

export const MASTER_KINDS = Object.freeze({
  SPECIALIZATION: "specialization",
  STATE: "state",
  DISTRICT: "district",
  CITY: "city",
});

const FIELD_CONFIG = Object.freeze({
  specialization: { kind: MASTER_KINDS.SPECIALIZATION, idField: "specializationMasterId", typeField: "specializationType", otherField: "specializationOther", max: 100 },
  state: { kind: MASTER_KINDS.STATE, idField: "stateMasterId", typeField: "stateType", otherField: "stateOther", max: 100 },
  district: { kind: MASTER_KINDS.DISTRICT, idField: "districtMasterId", typeField: "districtType", otherField: "districtOther", max: 120 },
  city: { kind: MASTER_KINDS.CITY, idField: "cityMasterId", typeField: "cityType", otherField: "cityOther", max: 100 },
});

const normalize = normalizeMasterText;
const normalizedName = (value) => normalize(value).toLowerCase();

export const OTHER_VALUE = "OTHER";

export const assertValidOther = (value, field) => {
  const config = FIELD_CONFIG[field];
  try {
    return validateOtherValue(value, config.max, field);
  } catch (error) {
    throw new AppError(error.message, 422);
  }
};

const getMasterById = async (id, kind) => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${kind} master-data id`, 400);
  }
  const item = await MasterData.findOne({ _id: id, kind, active: true }).lean();
  if (!item) throw new AppError(`Unknown ${kind} master-data value`, 422);
  return item;
};

const getMasterByName = async (value, kind) => {
  const text = normalize(value);
  if (!text) return null;
  return MasterData.findOne({ kind, normalizedName: normalizedName(text), active: true }).lean();
};

const resolveMasterSelection = async (field, payload, options = {}) => {
  const config = FIELD_CONFIG[field];
  const type = String(payload?.[config.typeField] || "").toUpperCase();
  const id = payload?.[config.idField];
  const legacyValue = payload?.[field];

  if (type === OTHER_VALUE) {
    return {
      type: OTHER_VALUE,
      masterId: null,
      otherValue: assertValidOther(payload?.[config.otherField], field),
      displayValue: "Other",
    };
  }

  if (type === "MASTER" || id) {
    const item = await getMasterById(id, config.kind);
    return {
      type: "MASTER",
      masterId: item._id,
      otherValue: "",
      displayValue: item.name,
    };
  }

  const existing = await getMasterByName(legacyValue, config.kind);
  if (existing) {
    return {
      type: "MASTER",
      masterId: existing._id,
      otherValue: "",
      displayValue: existing.name,
    };
  }

  if (options.allowLegacyOther && normalize(legacyValue)) {
    return {
      type: OTHER_VALUE,
      masterId: null,
      otherValue: assertValidOther(legacyValue, field),
      displayValue: "Other",
    };
  }

  throw new AppError(`${field} must reference canonical master data or use Other`, 422);
};

const assertLocationParent = async ({ child, parentField, parent }) => {
  if (child.type !== "MASTER") return;
  if (!parent) return;
  if (parent.type !== "MASTER") {
    throw new AppError(`${child.kind || "Location"} cannot use a canonical value with an Other parent`, 422);
  }
  if (!child.masterId || !parent.masterId) return;
  const childDoc = await MasterData.findById(child.masterId).select("parentId").lean();
  if (!childDoc) {
    throw new AppError(`${child.kind || parentField} does not belong to the selected parent`, 422);
  }
  try {
    assertMasterParent(childDoc.parentId, parent.masterId, child.kind || parentField);
  } catch (error) {
    throw new AppError(error.message, 422);
  }
};

export const resolveDoctorMasterData = async (payload = {}, options = {}) => {
  const hasAny = ["specialization", "state", "district", "city"].some((field) => {
    const c = FIELD_CONFIG[field];
    return payload[field] !== undefined || payload[c.idField] !== undefined || payload[c.typeField] !== undefined || payload[c.otherField] !== undefined;
  });
  if (!hasAny) return {};

  const resolved = {};
  for (const field of ["specialization", "state", "district", "city"]) {
    const c = FIELD_CONFIG[field];
    const present = payload[field] !== undefined || payload[c.idField] !== undefined || payload[c.typeField] !== undefined || payload[c.otherField] !== undefined;
    if (!present) continue;
    resolved[field] = await resolveMasterSelection(field, payload, options);
  }

  if (resolved.city?.type === "MASTER" && !resolved.district) {
    throw new AppError("City requires a selected district", 422);
  }
  if (resolved.district?.type === "MASTER" && !resolved.state) {
    throw new AppError("District requires a selected state", 422);
  }
  if (resolved.city && resolved.district) {
    await assertLocationParent({ child: { ...resolved.city, kind: "City" }, parentField: "district", parent: { ...resolved.district, kind: "District" } });
  }
  if (resolved.district && resolved.state) {
    await assertLocationParent({ child: { ...resolved.district, kind: "District" }, parentField: "state", parent: { ...resolved.state, kind: "State" } });
  }
  if (resolved.city?.type === "MASTER" && resolved.district?.type === "OTHER") {
    throw new AppError("City must be Other when its district is Other", 422);
  }
  if (resolved.district?.type === "MASTER" && resolved.state?.type === "OTHER") {
    throw new AppError("District must be Other when its state is Other", 422);
  }

  return resolved;
};

export const applyDoctorMasterData = (doctor, resolved) => {
  for (const [field, selection] of Object.entries(resolved || {})) {
    const config = FIELD_CONFIG[field];
    doctor[field] = selection.displayValue;
    doctor[config.idField] = selection.masterId;
    doctor[config.typeField] = selection.type;
    doctor[config.otherField] = selection.otherValue || "";
  }
};

export const serializeDoctorMasterData = (doctor) => {
  const result = {};
  for (const [field, config] of Object.entries(FIELD_CONFIG)) {
    result[field] = {
      type: doctor?.[config.typeField] || (doctor?.[config.idField] ? "MASTER" : "OTHER"),
      masterId: doctor?.[config.idField] || null,
      value: doctor?.[field] || "",
      otherValue: doctor?.[config.otherField] || "",
    };
  }
  return result;
};

export const listMasterData = async ({ kind, parentId } = {}) => {
  const filter = { kind, active: true };
  if (parentId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(parentId)) throw new AppError("Invalid parent master-data id", 400);
    filter.parentId = parentId;
  }
  return MasterData.find(filter).select("_id kind name parentId").sort({ name: 1 }).limit(500).lean();
};

// Safe bootstrap/backfill: only values present in the repository-controlled
// canonical seed are promoted to MASTER. Legacy values outside that source are
// preserved verbatim as OTHER and never create new canonical records.
export const bootstrapMasterDataFromDoctors = async () => {
  const doctors = await Doctor.find({})
    .select("_id specialization state district city clinics")
    .lean();

  const seeded = new Map();
  let created = 0;
  let migrated = 0;

  for (const seed of CANONICAL_MASTER_SEEDS) {
    const parentKey = seed.parentKey || "";
    const key = `${seed.kind}:${parentKey}:${normalizedName(seed.name)}`;
    const existing = await MasterData.findOne({
      kind: seed.kind,
      parentId: seed.parentId || null,
      normalizedName: normalizedName(seed.name),
    });
    const item = existing || await MasterData.create({
      kind: seed.kind,
      parentId: seed.parentId || null,
      name: seed.name,
      normalizedName: normalizedName(seed.name),
      active: true,
      source: "seed",
    });
    if (!existing) created += 1;
    if (item.source !== "seed" || !item.active) {
      await MasterData.updateOne({ _id: item._id }, { $set: { source: "seed", active: true } });
    }
    seeded.set(key, item);
  }

  const seedLookup = (kind, value) => {
    const text = normalize(value);
    if (!text) return null;
    return seeded.get(`${kind}::${normalizedName(text)}`) || null;
  };

  const applySelection = (set, field, value, kind) => {
    const original = normalize(value);
    if (!original) {
      set[`${field}MasterId`] = null;
      set[`${field}Type`] = "OTHER";
      set[`${field}Other`] = "";
      return null;
    }
    const master = seedLookup(kind, original);
    if (master) {
      set[`${field}MasterId`] = master._id;
      set[`${field}Type`] = "MASTER";
      set[`${field}Other`] = "";
      return master;
    }
    set[`${field}MasterId`] = null;
    set[`${field}Type`] = "OTHER";
    set[`${field}Other`] = original;
    return null;
  };

  for (const doctor of doctors) {
    const set = {};
    const specialization = applySelection(set, "specialization", doctor.specialization, MASTER_KINDS.SPECIALIZATION);
    const state = applySelection(set, "state", doctor.state, MASTER_KINDS.STATE);
    const district = applySelection(set, "district", doctor.district, MASTER_KINDS.DISTRICT);
    const city = applySelection(set, "city", doctor.city, MASTER_KINDS.CITY);

    // Geography is promoted only when the repository seed explicitly contains
    // the complete hierarchy. No legacy string is allowed to manufacture a
    // parent/child relationship.
    if (district && state && String(district.parentId || "") !== String(state._id)) {
      set.districtMasterId = null;
      set.districtType = "OTHER";
      set.districtOther = normalize(doctor.district);
    }
    if (city && district && String(city.parentId || "") !== String(district._id)) {
      set.cityMasterId = null;
      set.cityType = "OTHER";
      set.cityOther = normalize(doctor.city);
    }
    if (district?.parentId && !state) {
      set.districtMasterId = null;
      set.districtType = "OTHER";
      set.districtOther = normalize(doctor.district);
    }
    if (city?.parentId && !district) {
      set.cityMasterId = null;
      set.cityType = "OTHER";
      set.cityOther = normalize(doctor.city);
    }

    const changed = [
      "specializationMasterId", "specializationType", "specializationOther",
      "stateMasterId", "stateType", "stateOther",
      "districtMasterId", "districtType", "districtOther",
      "cityMasterId", "cityType", "cityOther",
    ].some((field) => String(doctor[field] ?? "") !== String(set[field] ?? ""));

    if (changed) {
      await Doctor.updateOne({ _id: doctor._id }, { $set: set });
      migrated += 1;
    }
  }

  // Existing MasterData documents created by the old unsafe bootstrap are not
  // authoritative. Deactivate only values outside the deterministic seed;
  // they remain in the collection for auditability rather than being deleted.
  const seededIds = [...seeded.values()].map((item) => item._id);
  const deactivated = await MasterData.updateMany(
    { _id: { $nin: seededIds }, active: true },
    { $set: { active: false, source: "legacy" } },
  );

  return {
    checkedDoctors: doctors.length,
    created,
    migrated,
    deactivatedUntrustedMasterData: deactivated.modifiedCount || 0,
  };
};

export const resolveCanonicalFilterValue = async (value, kind, label = kind) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(`Invalid ${label} master-data id`, 400);
  }
  return getMasterById(value, kind);
};

export const validateCanonicalLocationFilters = async ({ state, district, city } = {}) => {
  const result = {};
  if (state) result.state = await resolveCanonicalFilterValue(state, MASTER_KINDS.STATE, "state");
  if (district) result.district = await resolveCanonicalFilterValue(district, MASTER_KINDS.DISTRICT, "district");
  if (city) result.city = await resolveCanonicalFilterValue(city, MASTER_KINDS.CITY, "city");

  if (result.district && result.district.parentId && result.state && String(result.district.parentId) !== String(result.state._id)) {
    throw new AppError("District does not belong to the selected state", 422);
  }
  if (result.city && result.city.parentId && result.district && String(result.city.parentId) !== String(result.district._id)) {
    throw new AppError("City does not belong to the selected district", 422);
  }

  // If a child filter is supplied without its parent, derive the parent so the
  // query remains a valid canonical hierarchy.
  if (result.district && !result.state) {
    result.state = result.district.parentId ? await MasterData.findOne({ _id: result.district.parentId, kind: MASTER_KINDS.STATE, active: true }).lean() : null;
  }
  if (result.city && !result.district) {
    result.district = result.city.parentId ? await MasterData.findOne({ _id: result.city.parentId, kind: MASTER_KINDS.DISTRICT, active: true }).lean() : null;
    if (!result.district) throw new AppError("City has no valid canonical district parent", 422);
    if (!result.state && result.district.parentId) {
      result.state = await MasterData.findOne({ _id: result.district.parentId, kind: MASTER_KINDS.STATE, active: true }).lean();
    }
  }
  return result;
};

export const masterDataFieldConfig = FIELD_CONFIG;
