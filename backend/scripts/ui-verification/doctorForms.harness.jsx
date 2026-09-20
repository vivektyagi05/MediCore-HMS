import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n/I18nContext.jsx";
import { ToastProvider } from "../../../src/context/ToastContext.jsx";
import { AuthProvider } from "../../../src/context/AuthContext.jsx";
import DoctorProfessionalProfile from "../../../src/pages/doctor/DoctorProfessionalProfile.jsx";
import DoctorOnboarding from "../../../src/pages/doctor/DoctorOnboarding.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const results = [];
const check = (n, ok, e = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", n, e); };
const settle = async (ms = 1500) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const opts = (el) => [...el.querySelectorAll("option")].map((o) => ({ v: o.value, t: o.textContent }));
const q = (tid) => document.querySelector(`[data-testid="${tid}"]`);
const setSelect = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, value); el.dispatchEvent(new window.Event("change", { bubbles: true })); }); };
const typeInto = async (el, text) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, text); el.dispatchEvent(new window.Event("input", { bubbles: true })); }); };
const selectedText = (el) => el.options[el.selectedIndex]?.textContent;
const mount = async (Page) => {
  const host = document.getElementById("root"); host.innerHTML = "";
  const root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><I18nProvider><ToastProvider><AuthProvider><Page /></AuthProvider></ToastProvider></I18nProvider></MemoryRouter>); });
  // wait (bounded) until the location fields have finished their initial loads
  for (let i = 0; i < 20; i += 1) {
    await settle(500);
    const el = document.querySelector('[data-testid="location-state"]');
    if (el && !/Loading/.test(el.options[0]?.textContent || "")) break;
  }
  await settle(800);
  return root;
};
const unmount = async (root) => { await act(async () => { root.unmount(); }); };

// ---------- Professional profile: select, save, "refresh", persist ----------
let root = await mount(DoctorProfessionalProfile);
check("profile page loaded for a PENDING doctor (no blocking 403)", !!q("doctor-location-fields") && !/not yet approved/i.test(document.body.textContent));
check("state select is NOT preselected to 'Other' for a doctor with no saved location", selectedText(q("location-state")) === "Select state", `selected='${selectedText(q("location-state"))}'`);
const saveBtn = () => [...document.querySelectorAll("button")].find((b) => /save/i.test(b.textContent) && !/photo/i.test(b.textContent));
check("Save is disabled when nothing changed (dirty baseline fixed)", saveBtn()?.disabled === true);
const stateOptions = opts(q("location-state"));
check("state dropdown lists real states incl. Rajasthan/UP/Delhi/Maharashtra", ["Rajasthan", "Uttar Pradesh", "Delhi", "Maharashtra"].every((n) => stateOptions.some((o) => o.t === n)), `n=${stateOptions.length}`);
await setSelect(q("location-state"), stateOptions.find((o) => o.t === "Rajasthan").v); await settle(1500);
const jaipur = opts(q("location-district")).find((o) => o.t === "Jaipur");
check("Jaipur loads under Rajasthan", !!jaipur);
await setSelect(q("location-district"), jaipur.v); await settle(300);
await typeInto(q("location-city"), "jaipur"); await settle(200);
const specSel = [...document.querySelectorAll("select")].find((s) => opts(s).some((o) => o.t === "Cardiology"));
await setSelect(specSel, opts(specSel).find((o) => o.t === "Cardiology").v); await settle(200);
check("Save enabled after editing", saveBtn()?.disabled === false);
await act(async () => { saveBtn().click(); }); await settle(2500);
check("save succeeded (no error toast, page reloaded, not dirty)", saveBtn()?.disabled === true && !/failed|error/i.test(document.body.textContent.slice(0, 400)));
await unmount(root);

// simulate browser refresh: brand-new mount, fresh API calls
root = await mount(DoctorProfessionalProfile);
check("REFRESH: state persisted (Rajasthan selected)", selectedText(q("location-state")) === "Rajasthan", `got '${selectedText(q("location-state"))}'`);
check("REFRESH: district persisted (Jaipur selected)", selectedText(q("location-district")) === "Jaipur", `got '${selectedText(q("location-district"))}'`);
check("REFRESH: city persisted (canonical 'Jaipur' resolved from typed 'jaipur')", q("location-city").value === "Jaipur", `got '${q("location-city").value}'`);
check("REFRESH: specialization persisted (Cardiology)", selectedText([...document.querySelectorAll("select")].find((s) => opts(s).some((o) => o.t === "Cardiology"))) === "Cardiology");
check("REFRESH: form is clean (Save disabled)", saveBtn()?.disabled === true);
// change state -> children cleared -> save -> persisted cleared
const upOpt = opts(q("location-state")).find((o) => o.t === "Uttar Pradesh");
await setSelect(q("location-state"), upOpt.v); await settle(1500);
check("state change clears district select and city input", q("location-district").value === "" && q("location-city").value === "" && q("location-city").disabled === true);
await act(async () => { saveBtn().click(); }); await settle(2500);
await unmount(root);
root = await mount(DoctorProfessionalProfile);
check("REFRESH after state change: Uttar Pradesh saved, district/city empty (no stale Jaipur)", selectedText(q("location-state")) === "Uttar Pradesh" && q("location-district").value === "" && q("location-city").value === "");
await unmount(root);

// ---------- Onboarding page: restores saved canonical ids ----------
root = await mount(DoctorOnboarding);
check("onboarding page loads for a pending doctor (no 403 blocking)", !!q("doctor-location-fields") && !/not yet approved/i.test(document.body.textContent));
check("ONBOARDING restores saved state (Uttar Pradesh)", selectedText(q("location-state")) === "Uttar Pradesh", `got '${selectedText(q("location-state"))}'`);
await setSelect(q("location-district"), opts(q("location-district")).find((o) => o.t === "Mathura").v); await settle(300);
await typeInto(q("location-city"), "Mathura"); await settle(200);
check("onboarding city is a text input and district gate works", q("location-city").tagName === "INPUT" && q("location-city").disabled === false && q("location-city").value === "Mathura");
await unmount(root);

console.log("SUMMARY", results.filter(Boolean).length + "/" + results.length);
process.exit(results.every(Boolean) ? 0 : 1);
