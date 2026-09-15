import { generateDaySlots, computeAvailableSlots, validateAndDeriveAvailability } from "../utils/slotEngine.js";
import assert from "assert";

// 1. Basic generation: 9-11, 30min slots, 5min buffer -> 09:00-09:30, 09:35-10:05, 10:10-10:40, 10:45-11:15(exceeds end 11:00, excluded)
let slots = generateDaySlots({ startTime: "09:00", endTime: "11:00", slotDurationMinutes: 30, bufferMinutes: 5 });
assert.deepStrictEqual(slots, ["09:00-09:30", "09:35-10:05", "10:10-10:40"]);
console.log("PASS: basic generation with buffer", slots);

// 2. Break exclusion
slots = generateDaySlots({ startTime: "09:00", endTime: "11:00", slotDurationMinutes: 30, bufferMinutes: 0, breaks: [{ start: "09:30", end: "10:00" }] });
assert.deepStrictEqual(slots, ["09:00-09:30", "10:00-10:30", "10:30-11:00"]);
console.log("PASS: break exclusion", slots);

// 3. Legacy manual slots passthrough
slots = generateDaySlots({ dayOfWeek: "monday", timeSlots: ["09:00", "10:00"] });
assert.deepStrictEqual(slots, ["09:00", "10:00"]);
console.log("PASS: legacy passthrough", slots);

// 4. computeAvailableSlots removes taken slots
const avail = computeAvailableSlots({
  dayConfig: { startTime: "09:00", endTime: "10:00", slotDurationMinutes: 30, bufferMinutes: 0 },
  takenSlotCounts: { "09:00-09:30": 1 },
});
assert.deepStrictEqual(avail, ["09:30-10:00"]);
console.log("PASS: taken slot removed", avail);

// 5. validateAndDeriveAvailability rejects end <= start
assert.throws(() => validateAndDeriveAvailability([{ dayOfWeek: "monday", startTime: "10:00", endTime: "09:00", slotDurationMinutes: 30 }]));
console.log("PASS: rejects invalid time range");

// 6. validateAndDeriveAvailability rejects break outside working hours
assert.throws(() => validateAndDeriveAvailability([{ dayOfWeek: "monday", startTime: "09:00", endTime: "17:00", slotDurationMinutes: 30, breaks: [{ start: "08:00", end: "08:30" }] }]));
console.log("PASS: rejects out-of-range break");

// 7. validateAndDeriveAvailability derives timeSlots for structured config
const derived = validateAndDeriveAvailability([{ dayOfWeek: "monday", startTime: "09:00", endTime: "10:00", slotDurationMinutes: 30 }]);
assert.deepStrictEqual(derived[0].timeSlots, ["09:00-09:30", "09:30-10:00"]);
console.log("PASS: derives timeSlots", derived[0].timeSlots);

// 8. validateAndDeriveAvailability keeps legacy manual day untouched
const legacy = validateAndDeriveAvailability([{ dayOfWeek: "tuesday", timeSlots: ["09:00", "09:30"] }]);
assert.deepStrictEqual(legacy[0].timeSlots, ["09:00", "09:30"]);
console.log("PASS: legacy day untouched", legacy[0].timeSlots);

// 9. duplicate detection across days sharing same key would not apply (different dayOfWeek), but same day duplicate manual entries should be impossible via array since Set is per (day:slot)
console.log("ALL SLOT ENGINE TESTS PASSED");
