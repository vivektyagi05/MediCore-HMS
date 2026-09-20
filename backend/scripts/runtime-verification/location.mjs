import { api, dbConnect, registerDevDoctor, ADMIN_EMAIL, ADMIN_PASSWORD } from "./lib.mjs";
const m = await dbConnect();
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };
const d = await registerDevDoctor(m, "loc1");
const t = d.token;
const states = (await api("GET", "/master-data/states")).json.data;
const st = (n) => states.find((s) => s.name === n);
const raj = st("Rajasthan"), up = st("Uttar Pradesh"), dl = st("Delhi"), mh = st("Maharashtra");
check("states list includes Rajasthan/UP/Delhi/Maharashtra", !!(raj && up && dl && mh), `count=${states.length}`);
const rajD = (await api("GET", `/master-data/districts?parent=${raj._id}`)).json.data;
const upD = (await api("GET", `/master-data/districts?parent=${up._id}`)).json.data;
const jaipur = rajD.find((x) => x.name === "Jaipur"), mathura = upD.find((x) => x.name === "Mathura");
check("Rajasthan districts contain Jaipur; UP districts contain Mathura", !!(jaipur && mathura), `raj=${rajD.length} up=${upD.length}`);
check("no cross-parent leakage (Mathura not under Rajasthan, Jaipur not under UP)", !rajD.some((x) => x.name === "Mathura") && !upD.some((x) => x.name === "Jaipur"));
const jaipurCities = (await api("GET", `/master-data/cities?parent=${jaipur._id}`)).json.data;
const mathuraCities = (await api("GET", `/master-data/cities?parent=${mathura._id}`)).json.data;
const jaipurCity = jaipurCities.find((c) => c.name === "Jaipur"), mathuraCity = mathuraCities.find((c) => c.name === "Mathura");
check("cities under Jaipur district contain Jaipur", !!jaipurCity, `n=${jaipurCities.length}`);
check("invalid parent -> 400", (await api("GET", "/master-data/districts?parent=not-an-id")).status === 400);
check("city id as district parent... wrong kind -> 422", (await api("GET", `/master-data/districts?parent=${jaipur._id}`)).status === 422);
check("cities without parent -> 400", (await api("GET", "/master-data/cities")).status === 400);
const specs = (await api("GET", "/master-data/specializations")).json.data;
const card = specs.find((s) => s.name === "Cardiology");
check("specializations non-empty incl. Cardiology", specs.length >= 26 && !!card, `n=${specs.length}`);

const patch = (body) => api("PATCH", "/doctor/practice/professional-profile", { token: t, body });
const loc = (o) => ({ state: "", stateMasterId: "", stateType: "", stateOther: "", district: "", districtMasterId: "", districtType: "", districtOther: "", city: "", cityMasterId: "", cityType: "", cityOther: "", ...o });
const master = (level, item) => ({ [level]: item.name, [`${level}MasterId`]: item._id, [`${level}Type`]: "MASTER", [`${level}Other`]: "" });
const get = async () => (await api("GET", "/doctor/practice/professional-profile", { token: t })).json.data;

// A canonical city typed
let r = await patch({ ...loc({ ...master("state", raj), ...master("district", jaipur), city: "jaipur", cityType: "OTHER", cityOther: "jaipur" }), ...master("specialization", card) });
check("pending doctor can save profile (A: typed 'jaipur' in Jaipur district)", r.status === 200, `status=${r.status} ${r.json?.message||""}`);
let g = await get();
check("typed city resolved to canonical (MASTER + id)", g.cityType === "MASTER" && String(g.cityMasterId) === String(jaipurCity._id) && g.city === "Jaipur", `${g.cityType} ${g.city}`);
check("state/district/specialization persisted & returned for reload", String(g.stateMasterId) === raj._id && String(g.districtMasterId) === jaipur._id && String(g.specializationMasterId) === card._id);

// B non-canonical city
r = await patch(loc({ ...master("state", raj), ...master("district", jaipur), city: "Some Colony Nagar", cityType: "OTHER", cityOther: "Some Colony Nagar" }));
g = await get();
check("B: non-canonical city -> OTHER, cityMasterId null", r.status === 200 && g.cityType === "OTHER" && !g.cityMasterId && g.cityOther === "Some Colony Nagar", `status=${r.status} type=${g.cityType}`);

// C cross-district canonical id rejected
r = await patch(loc({ ...master("state", raj), ...master("district", jaipur), city: mathuraCity.name, cityMasterId: mathuraCity._id, cityType: "MASTER" }));
check("C: canonical Mathura city id under Jaipur district rejected", r.status === 422, `status=${r.status} ${r.json?.message||""}`);

// D typed 'Mathura' under Jaipur -> OTHER, never global match
r = await patch(loc({ ...master("state", raj), ...master("district", jaipur), city: "Mathura", cityType: "OTHER", cityOther: "Mathura" }));
g = await get();
check("D: 'Mathura' typed under Jaipur district stays OTHER (no global match)", r.status === 200 && g.cityType === "OTHER" && !g.cityMasterId, `type=${g.cityType}`);

// district from wrong state rejected
r = await patch(loc({ ...master("state", raj), ...master("district", mathura) }));
check("E: Mathura district under Rajasthan rejected", r.status === 422, `status=${r.status}`);

// state change with cleared children
r = await patch(loc({ ...master("state", up) }));
g = await get();
check("F: changing state with children cleared saves; stale district/city gone", r.status === 200 && String(g.stateMasterId) === up._id && !g.districtMasterId && !g.city, `status=${r.status} district='${g.district}' city='${g.city}'`);

// UP -> Mathura -> Mathura city canonical
r = await patch(loc({ ...master("state", up), ...master("district", mathura), city: "Mathura", cityType: "OTHER", cityOther: "Mathura" }));
g = await get();
check("G: Mathura in Mathura district -> MASTER", r.status === 200 && g.cityType === "MASTER" && String(g.cityMasterId) === String(mathuraCity._id));

// OTHER state / district / city
r = await patch(loc({ stateType: "OTHER", stateOther: "Foreignland", districtType: "OTHER", districtOther: "Some District", city: "Town", cityType: "OTHER", cityOther: "Town" }));
g = await get();
check("H: Other state + Other district + typed city saved", r.status === 200 && g.stateType === "OTHER" && g.stateOther === "Foreignland" && g.districtOther === "Some District" && g.cityOther === "Town", `status=${r.status} ${r.json?.message||""}`);

// verification-related fields via onboarding update (pending)
r = await api("PUT", "/doctor/onboarding", { token: t, body: { qualification: "MBBS (DEV TEST)", licenseNumber: "DEV-TEST-0001", medicalCouncil: "DEV TEST COUNCIL", collegeName: "DEV TEST COLLEGE", graduationYear: 2010, experience: 5, fees: 500, ...loc({ ...master("state", raj), ...master("district", jaipur), city: "Jaipur", cityType: "OTHER", cityOther: "Jaipur" }), ...master("specialization", card) } });
check("pending doctor: PUT /doctor/onboarding saves qualifications/experience/verification details/location", r.status === 200, `status=${r.status} ${r.json?.message||""}`);
const ob = (await api("GET", "/doctor/onboarding", { token: t })).json.data;
check("onboarding GET returns saved ids for reload", String(ob.stateMasterId) === raj._id && String(ob.districtMasterId) === jaipur._id && String(ob.cityMasterId) === String(jaipurCity._id) && ob.licenseNumber === "DEV-TEST-0001" && ob.verificationStatus !== "approved", `status=${ob.verificationStatus}`);
console.log("\nSUMMARY", results.filter(Boolean).length + "/" + results.length, "passed");
process.exitCode = results.every(Boolean) ? 0 : 1;
await m.disconnect();
