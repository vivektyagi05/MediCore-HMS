import assert from "node:assert/strict";
import { buildDoctorGeographicFilter, buildLocationAggregationMatch } from "../utils/geographicSearch.js";

const query = { state: "Rajasthan", district: "Jaipur", city: "Jaipur" };
const filter = buildDoctorGeographicFilter(query);
assert.equal(filter.$or.length, 2);
assert.deepEqual(Object.keys(filter.$or[0]).sort(), ["city", "district", "state"]);
assert.deepEqual(Object.keys(filter.$or[1].clinics.$elemMatch).sort(), ["city", "district", "state"]);
const aggregation = buildLocationAggregationMatch(query);
assert.deepEqual(Object.keys(aggregation.$match).sort(), ["locations.city", "locations.district", "locations.state"]);
const noGeo = buildDoctorGeographicFilter({ specialization: "Cardiology" });
assert.equal(noGeo, null);
console.log("P12 geographic helper unit checks passed");
