import { api, dbConnect, registerDevDoctor, ADMIN_EMAIL, ADMIN_PASSWORD } from "./lib.mjs";
const m = await dbConnect();
const db = m.connection.db;
const results = [];
// FerretDB (used when no real MongoDB is available) lacks $year/$lookup/etc. A response that fails ONLY
// because the engine lacks an operator is reported as SKIPPED (not PASS) and does not fail the run.
const engineLimited = (r) => r.status === 500 && /not implemented/i.test(r.json?.message || "");
const skipOrCheck = (name, r, ok) => { if (engineLimited(r)) { console.log("SKIP", name, "(engine limitation:", r.json.message.slice(0, 60) + ")"); } else check(name, ok, `status=${r.status}`); };
const check = (name, ok, extra = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };
const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const login = async (email, password) => (await api("POST", "/auth/login", { body: { email, password } })).json.data;
const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
const A = admin.token;

// dev patient
const pEmail = "dev-patient-vis@medicore-dev.test", pPass = "DevTest#Pass12345";
await api("POST", "/auth/register", { body: { name: "DEV TEST Patient", email: pEmail, password: pPass, role: "patient", acceptTerms: true, termsAccepted: true } });
await db.collection("users").updateOne({ email: pEmail }, { $set: { emailVerified: true } });
const patient = await login(pEmail, pPass);
const PT = patient.token;

const states = (await api("GET", "/master-data/states")).json.data;
const raj = states.find((s) => s.name === "Rajasthan");
const jaipur = (await api("GET", `/master-data/districts?parent=${raj._id}`)).json.data.find((d) => d.name === "Jaipur");
const card = (await api("GET", "/master-data/specializations")).json.data.find((s) => s.name === "Cardiology");
const mk = (level, item) => ({ [level]: item.name, [`${level}MasterId`]: item._id, [`${level}Type`]: "MASTER", [`${level}Other`]: "" });

const makeDoctor = async (tag) => {
  const d = await registerDevDoctor(m, tag);
  const r = await api("PUT", "/doctor/onboarding", { token: d.token, body: { qualification: "MBBS (DEV TEST)", licenseNumber: `DEV-${tag}`, medicalCouncil: "DEV TEST COUNCIL", collegeName: "DEV TEST COLLEGE", graduationYear: 2010, experience: 5, fees: 500, ...mk("state", raj), ...mk("district", jaipur), city: "Jaipur", cityType: "OTHER", cityOther: "Jaipur", ...mk("specialization", card), consultationMode: ["online"] } });
  if (r.status !== 200) throw new Error(`onboarding ${tag} ${r.status} ${JSON.stringify(r.json)}`);
  const user = await db.collection("users").findOne({ email: d.email });
  await db.collection("doctors").updateOne({ userId: user._id }, { $set: { availability: days.map((dayOfWeek) => ({ dayOfWeek, timeSlots: [], startTime: "09:00", endTime: "12:00", slotDurationMinutes: 30, bufferMinutes: 0, breaks: [] })), consultationMode: ["online"] } });
  const doc = await db.collection("doctors").findOne({ userId: user._id });
  return { ...d, userId: user._id, id: String(doc._id) };
};
const P = await makeDoctor("vis-pending"), OK = await makeDoctor("vis-approved"), R = await makeDoctor("vis-rejected"), I = await makeDoctor("vis-inactive"), U = await makeDoctor("vis-unverified");
for (const d of [P, OK, R, I, U]) {
  await db.collection("doctors").updateOne({ _id: new m.Types.ObjectId(d.id) }, { $set: { verificationStatus: "pending", isVerified: false, isActive: true, verificationNotes: "" } });
  await db.collection("users").updateOne({ _id: d.userId }, { $set: { isActive: true, doctorOnboardingStatus: "pending" } });
}
const state = async (d) => db.collection("doctors").findOne({ _id: new m.Types.ObjectId(d.id) });

const publicIds = async () => { const r = await api("GET", "/public/doctors?limit=50"); return (r.json.data.doctors || []).map((x) => String(x.id)); };
const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const surfaces = async (d, expectVisible, label) => {
  const ids = await publicIds();
  check(`${label}: public search ${expectVisible ? "shows" : "hides"} doctor`, ids.includes(d.id) === expectVisible);
  const prof = await api("GET", `/public/doctors/${d.id}`);
  check(`${label}: direct /public/doctors/:id -> ${expectVisible ? 200 : 404}`, prof.status === (expectVisible ? 200 : 404), `got ${prof.status}`);
  const rev = await api("GET", `/public/doctors/${d.id}/reviews`);
  check(`${label}: reviews ${expectVisible ? "200" : "404"}`, rev.status === (expectVisible ? 200 : 404), `got ${rev.status}`);
  const sim = await api("GET", `/public/doctors/${d.id}/similar`);
  check(`${label}: similar ${expectVisible ? "200" : "404"}`, sim.status === (expectVisible ? 200 : 404), `got ${sim.status}`);
  const av = await api("GET", `/public/doctor-availability?doctorIds=${d.id}`);
  check(`${label}: availability map ${expectVisible ? "contains" : "omits"} doctor`, (Object.keys(av.json?.data || {}).includes(d.id)) === expectVisible);
  const list = await api("GET", "/doctors?limit=50");
  check(`${label}: GET /api/doctors ${expectVisible ? "lists" : "omits"}`, JSON.stringify(list.json.data.doctors.map((x) => String(x._id))).includes(d.id) === expectVisible);
  const feat = await api("GET", "/public/featured-doctors");
  check(`${label}: featured ${expectVisible ? "may include" : "omits"}`, expectVisible || !JSON.stringify(feat.json.data).includes(d.id));
  const ai = await api("GET", "/ai/search?q=Cardio", { token: PT });
  check(`${label}: /ai/search ${expectVisible ? "returns" : "omits"}`, JSON.stringify(ai.json?.data || {}).includes(d.id) === expectVisible);
  const slots = await api("GET", `/appointments/available-slots?doctorId=${d.id}&date=${tomorrow}`, { token: PT });
  check(`${label}: available-slots ${expectVisible ? "200" : "403/404"}`, expectVisible ? slots.status === 200 : [403, 404].includes(slots.status), `got ${slots.status}`);
  const nxt = await api("GET", `/appointments/next-available?doctorId=${d.id}`, { token: PT });
  check(`${label}: next-available ${expectVisible ? "200" : "403"}`, expectVisible ? nxt.status === 200 : nxt.status === 403, `got ${nxt.status}`);
  return slots;
};
const tryBook = async (d, slot) => api("POST", "/appointments", { token: PT, body: { doctorId: d.id, date: tomorrow, timeSlot: slot || "09:00", reason: "DEV TEST booking", consultationMode: "online", consentAccepted: true, termsAccepted: true, privacyAccepted: true, bookingRequestId: `dev-${d.id}-${Date.now()}` } });

console.log("\n== 1. PENDING doctor ==");
let st = await state(P);
check("pending doctor DB state: verificationStatus=pending isVerified=false", st.verificationStatus === "pending" && st.isVerified === false, `${st.verificationStatus}/${st.isVerified}/${st.isActive}`);
await surfaces(P, false, "pending");
let b = await tryBook(P); check("pending doctor booking rejected (403)", b.status === 403, `got ${b.status} ${b.json?.message}`);
const adminList = await api("GET", "/doctors/pending", { token: A });
check("SUPER_ADMIN pending queue sees pending doctor", JSON.stringify(adminList.json).includes(P.id), `status=${adminList.status}`);
const detail = await api("GET", `/admin/doctors/${P.id}`, { token: A });
const statsBefore = (await api("GET", "/admin/doctors/stats", { token: A })).json.data;
skipOrCheck("SUPER_ADMIN can inspect pending doctor detail", detail, detail.status === 200);

console.log("\n== 2. APPROVAL cycle ==");
let ap = await api("PUT", `/doctors/${OK.id}/approve`, { token: A, body: { notes: "DEV TEST approval" } });
check("SUPER_ADMIN approve -> 200", ap.status === 200, `got ${ap.status} ${ap.json?.message}`);
st = await state(OK);
check("DB after approve: approved / isVerified / isActive", st.verificationStatus === "approved" && st.isVerified === true && st.isActive === true, `${st.verificationStatus}/${st.isVerified}/${st.isActive}`);
const slotsRes = await surfaces(OK, true, "approved");
const firstSlot = (slotsRes.json?.data?.slots || [])[0];
const slotStr = typeof firstSlot === "string" ? firstSlot : firstSlot?.time || firstSlot?.timeSlot || firstSlot?.slot;
b = await tryBook(OK, slotStr);
check("approved+verified+active doctor: booking allowed", [200, 201].includes(b.status), `got ${b.status} ${b.json?.message} slot=${slotStr}`);
const nonAdminApprove = await api("PUT", `/doctors/${P.id}/approve`, { token: PT });
check("non-admin cannot approve (403)", nonAdminApprove.status === 403, `got ${nonAdminApprove.status}`);

console.log("\n== 3. REJECTION + RESUBMISSION cycle ==");
let rj = await api("PUT", `/doctors/${R.id}/reject`, { token: A, body: { reason: "DEV TEST: rejected for verification" } });
check("SUPER_ADMIN reject -> 200", rj.status === 200, `got ${rj.status} ${rj.json?.message}`);
st = await state(R); check("DB after reject: rejected", st.verificationStatus === "rejected" && st.isVerified === false, st.verificationStatus);
await surfaces(R, false, "rejected");
b = await tryBook(R); check("rejected doctor booking rejected (403)", b.status === 403, `got ${b.status}`);
const admR = await api("GET", `/admin/doctors/${R.id}`, { token: A });
skipOrCheck("SUPER_ADMIN can still open rejected doctor", admR, admR.status === 200 && JSON.stringify(admR.json).includes(R.id));
const resub = await api("POST", "/doctor/onboarding", { token: R.token, body: { qualification: "MBBS (DEV TEST)", licenseNumber: "DEV-vis-rejected", medicalCouncil: "DEV TEST COUNCIL", collegeName: "DEV TEST COLLEGE", graduationYear: 2010, experience: 5, fees: 500, ...mk("state", raj), ...mk("district", jaipur), city: "Jaipur", cityType: "OTHER", cityOther: "Jaipur", ...mk("specialization", card) } });
check("rejected doctor can resubmit (status -> pending)", [200, 201].includes(resub.status), `got ${resub.status} ${resub.json?.message}`);
st = await state(R); check("DB after resubmission: pending", st.verificationStatus === "pending", st.verificationStatus);
check("resubmitted doctor absent from public search", !(await publicIds()).includes(R.id));

console.log("\n== 4. INACTIVE doctor ==");
await api("PUT", `/doctors/${I.id}/approve`, { token: A, body: {} });
await db.collection("doctors").updateOne({ _id: new m.Types.ObjectId(I.id) }, { $set: { isActive: false } });
st = await state(I); check("inactive fixture: approved+verified but isActive=false", st.verificationStatus === "approved" && st.isVerified && !st.isActive);
await surfaces(I, false, "inactive");
b = await tryBook(I); check("inactive doctor booking rejected (403)", b.status === 403, `got ${b.status}`);
const admI = await api("GET", `/admin/doctors/${I.id}`, { token: A });
skipOrCheck("SUPER_ADMIN can still open inactive doctor", admI, admI.status === 200);

console.log("\n== 5. UNVERIFIED doctor (approved status, isVerified=false) ==");
await api("PUT", `/doctors/${U.id}/approve`, { token: A, body: {} });
await db.collection("doctors").updateOne({ _id: new m.Types.ObjectId(U.id) }, { $set: { isVerified: false } });
await surfaces(U, false, "unverified");
b = await tryBook(U); check("unverified doctor booking rejected (403)", b.status === 403, `got ${b.status}`);

console.log("\n== 6. Doctor USER account inactive ==");
await db.collection("users").updateOne({ _id: OK.userId }, { $set: { isActive: false } });
check("approved doctor with inactive user account is hidden", !(await publicIds()).includes(OK.id));
const prof = await api("GET", `/public/doctors/${OK.id}`); check("...and direct profile 404", prof.status === 404, `got ${prof.status}`);
await db.collection("users").updateOne({ _id: OK.userId }, { $set: { isActive: true } });
check("restored: doctor visible again", (await publicIds()).includes(OK.id));

const statsAfter = (await api("GET", "/admin/doctors/stats", { token: A })).json.data;
check("admin stats counts come from DB and reflect the cycle (approved/rejected/pending)", statsAfter.approved >= 1 && statsAfter.pending >= 2 && statsAfter.total >= 5, JSON.stringify(statsAfter));
console.log("\nSUMMARY", results.filter(Boolean).length + "/" + results.length, "passed");
process.exitCode = results.every(Boolean) ? 0 : 1;
await m.disconnect();
