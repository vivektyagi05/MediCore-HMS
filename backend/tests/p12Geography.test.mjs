import assert from "node:assert/strict";
import Doctor from "../models/Doctor.js";
import { generateDaySlots } from "../utils/slotEngine.js";

const district = Doctor.schema.path("district");
const locationType = Doctor.schema.path("location.type");
const locationCoordinates = Doctor.schema.path("location.coordinates");
const clinics = Doctor.schema.path("clinics");

assert.equal(district.instance, "String");
assert.equal(district.options.default, "");

assert.equal(locationType.instance, "String");
assert.deepEqual(locationType.options.enum, ["Point"]);

assert.equal(locationCoordinates.instance, "Array");

assert.equal(clinics.schema.path("district").instance, "String");

const clinicLocationType = clinics.schema.path("location.type");
const clinicLocationCoordinates = clinics.schema.path("location.coordinates");

assert.equal(clinicLocationType.instance, "String");
assert.deepEqual(clinicLocationType.options.enum, ["Point"]);

assert.equal(clinicLocationCoordinates.instance, "Array");



const has2dsphere = Doctor.schema.indexes().some(([fields]) => fields.location === "2dsphere");
assert.equal(has2dsphere, true);

assert.deepEqual(
  generateDaySlots({ dayOfWeek: "monday", startTime: "09:00", endTime: "10:00", slotDurationMinutes: 30 }),
  ["09:00-09:30", "09:30-10:00"],
);

console.log("P12 geography schema + slot-engine contract: PASS");
