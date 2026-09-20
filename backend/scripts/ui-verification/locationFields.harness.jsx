import { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import DoctorLocationFields from "../../../src/components/doctor/DoctorLocationFields.jsx";
import { EMPTY_LOCATION, buildLocationPayload } from "../../../src/utils/doctorLocation.js";
import { __calls } from "./apiShim.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let latest = EMPTY_LOCATION;
function App() { const [v, setV] = useState(EMPTY_LOCATION); latest = v; return <DoctorLocationFields value={v} onChange={setV} />; }

const results = []; const check = (n, ok, e = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", n, e); };
const q = (tid) => document.querySelector(`[data-testid="${tid}"]`);
const opts = (el) => [...el.querySelectorAll("option")].map((o) => o.textContent);
const settle = async (ms = 400) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const setSelect = async (tid, value) => { await act(async () => { const el = q(tid); const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set; setter.call(el, value); el.dispatchEvent(new window.Event("change", { bubbles: true })); }); };
const typeInto = async (tid, text) => { await act(async () => { const el = q(tid); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(el, text); el.dispatchEvent(new window.Event("input", { bubbles: true })); }); };

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(<App />); });
await settle(600);

const stateOpts = opts(q("location-state"));
check("state dropdown shows real Indian states (not just 'Other')", stateOpts.length > 30, `options=${stateOpts.length}`);
for (const s of ["Rajasthan", "Uttar Pradesh", "Delhi", "Maharashtra"]) check(`state dropdown contains ${s}`, stateOpts.includes(s));
check("district select disabled before a state is chosen", q("location-district").disabled === true);
check("city input disabled before a district is chosen", q("location-city").disabled === true);
check("city is a text input, not a select", q("location-city").tagName === "INPUT" && q("location-city").type === "text");

const stateId = (name) => [...q("location-state").querySelectorAll("option")].find((o) => o.textContent === name).value;
const raj = stateId("Rajasthan"), up = stateId("Uttar Pradesh");
await setSelect("location-state", raj); await settle(1500);
let dOpts = opts(q("location-district"));
check("Rajasthan selected -> districts load incl. Jaipur", dOpts.includes("Jaipur") && !dOpts.includes("Mathura"), `n=${dOpts.length}`);
const jaipurId = [...q("location-district").querySelectorAll("option")].find((o) => o.textContent === "Jaipur").value;
await setSelect("location-district", jaipurId); await settle(300);
check("district chosen -> city input enabled", q("location-city").disabled === false);
await typeInto("location-city", "Jaipur"); await settle(100);
let p = buildLocationPayload(latest);
check("payload: canonical state+district ids and typed city", p.stateType === "MASTER" && p.districtType === "MASTER" && p.city === "Jaipur" && p.cityType === "OTHER" && p.cityMasterId === "", JSON.stringify({ s: p.state, d: p.district, c: p.city }));

// reset semantics
await setSelect("location-state", up); await settle(1500);
check("state change clears district + city (no stale values)", latest.districtMasterId === "" && latest.city === "" && q("location-city").value === "" && q("location-city").disabled === true);
dOpts = opts(q("location-district"));
check("UP selected -> districts load incl. Mathura, no Jaipur (no cross-parent leakage)", dOpts.includes("Mathura") && !dOpts.includes("Jaipur"), `n=${dOpts.length}`);

// stale-request race: slow Rajasthan response must never overwrite UP
globalThis.__slowState = raj;
await setSelect("location-state", raj);       // slow request (800ms)
await setSelect("location-state", up);        // fast request, latest selection
await settle(1200);
dOpts = opts(q("location-district"));
check("stale async response ignored: latest selection (UP) wins over slow Rajasthan", dOpts.includes("Mathura") && !dOpts.includes("Jaipur") && latest.stateMasterId === up, `districts=${dOpts.length}`);
check("state 'Other' path exposes free-text state and district", await (async () => { await setSelect("location-state", "__other__"); await settle(100); return !!q("location-district-text"); })());
console.log("network calls made by the component:", JSON.stringify(__calls.map((c) => `${c.path.split("/").pop()} ${c.status} n=${c.n}`)));
console.log("SUMMARY", results.filter(Boolean).length + "/" + results.length);
process.exit(results.every(Boolean) ? 0 : 1);
