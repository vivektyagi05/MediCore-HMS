import assert from "node:assert/strict";
import { findTravelConflict as f } from "../services/appointmentBookingPolicyService.js";
const tz = "Asia/Kolkata", d = new Date("2026-09-24T00:00:00Z");
const a = (timeSlot, consultationMode, visitAddress) => ({ _id: timeSlot, date: d, timeSlot, consultationMode, visitAddress });
const home1 = { line1: "12 Park Rd", city: "Agra" }, home2 = { line1: "9 Lake St", city: "Agra" };
// hospital 10:00-10:30, home 11:00, hospital 11:30 — brief's example, 45 min buffer
const hospital = a("10:00-10:30", "in_person");
assert.equal(f({ candidate: a("11:00-11:30", "home_visit", home1), others: [hospital], bufferMinutes: 45, tz })?.gapMinutes, 30, "30 min gap < 45 → infeasible");
assert.equal(f({ candidate: a("11:15-11:45", "home_visit", home1), others: [hospital], bufferMinutes: 45, tz }), null, "45 min gap → feasible");
const home = a("11:00-11:30", "home_visit", home1);
assert.ok(f({ candidate: a("11:30-12:00", "in_person"), others: [home], bufferMinutes: 45, tz }), "home→hospital back-to-back infeasible");
assert.ok(f({ candidate: a("09:30-10:00", "home_visit", home1), others: [hospital], bufferMinutes: 45, tz }), "before works symmetrically");
assert.equal(f({ candidate: a("11:30-12:00", "home_visit", home1), others: [home], bufferMinutes: 45, tz }), null, "same address back-to-back needs no travel");
assert.ok(f({ candidate: a("11:30-12:00", "home_visit", home2), others: [home], bufferMinutes: 45, tz }), "different home addresses need travel");
assert.equal(f({ candidate: a("10:30-11:00", "in_person"), others: [hospital], bufferMinutes: 45, tz }), null, "two in-clinic slots never need travel");
assert.equal(f({ candidate: a("11:00-11:30", "home_visit", home1), others: [hospital], bufferMinutes: 0, tz }), null, "buffer disabled");
assert.equal(f({ candidate: a("weird", "home_visit", home1), others: [hospital], bufferMinutes: 45, tz }), null, "unparseable slot: no instant to compare");
console.log("PASS: home-visit travel buffer (configurable safety buffer, no fake routing)");
