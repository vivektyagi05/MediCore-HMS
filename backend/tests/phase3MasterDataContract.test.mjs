import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeMasterText, validateOtherValue, assertMasterParent } from "../utils/masterDataValidation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

assert.equal(normalizeMasterText("  Delhi  "), "Delhi");
assert.equal(validateOtherValue("  Neurology & Sleep  ", 100, "specialization"), "Neurology & Sleep");
assert.throws(() => validateOtherValue("", 100, "state"));
assert.throws(() => validateOtherValue("   ", 100, "city"));
assert.throws(() => validateOtherValue("x".repeat(101), 100, "specialization"));
assert.equal(assertMasterParent("a", "a", "District"), true);
assert.throws(() => assertMasterParent("a", "b", "District"));

const doctorSchema = fs.readFileSync(path.join(root, "models/Doctor.js"), "utf8");
const masterModel = fs.readFileSync(path.join(root, "models/MasterData.js"), "utf8");
const masterService = fs.readFileSync(path.join(root, "services/masterDataService.js"), "utf8");
const onboarding = fs.readFileSync(path.join(root, "controllers/doctorOnboardingController.js"), "utf8");
const practice = fs.readFileSync(path.join(root, "controllers/doctor/practiceController.js"), "utf8");
const publicController = fs.readFileSync(path.join(root, "controllers/publicController.js"), "utf8");
const adminController = fs.readFileSync(path.join(root, "controllers/admin/doctorAdminController.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/004_master_data_backfill.js"), "utf8");

assert.match(masterModel, /enum: \["specialization", "state", "district", "city"\]/);
assert.match(masterModel, /unique: true/);
assert.match(masterModel, /kind: 1, parentId: 1, normalizedName: 1/);
assert.match(masterService, /District.*selected parent|does not belong to the selected parent/);
assert.match(masterService, /City.*selected parent|does not belong to the selected parent/);
assert.match(masterService, /MASTER/);
assert.match(masterService, /OTHER/);
assert.match(doctorSchema, /specializationMasterId/);
assert.match(doctorSchema, /stateMasterId/);
assert.match(doctorSchema, /districtMasterId/);
assert.match(doctorSchema, /cityMasterId/);
assert.match(onboarding, /resolveDoctorMasterData/);
assert.match(onboarding, /applyDoctorMasterData/);
assert.match(practice, /resolveDoctorMasterData/);
assert.match(practice, /normalizeClinicMasterData/);
assert.match(publicController, /listMasterData/);
assert.match(adminController, /req\.query\.state/);
assert.match(adminController, /req\.query\.district/);
assert.match(adminController, /req\.query\.city/);
assert.match(migration, /bootstrapMasterDataFromDoctors/);

console.log("Phase-3 master-data contract: PASS");
