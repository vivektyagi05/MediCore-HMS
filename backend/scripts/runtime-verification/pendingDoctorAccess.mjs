import { api, dbConnect, registerDevDoctor, ADMIN_EMAIL, ADMIN_PASSWORD } from "./lib.mjs";
const m = await dbConnect();
const d = await registerDevDoctor(m, "pending1");
const list = [["GET","/auth/me"],["GET","/doctor/onboarding"],["PUT","/doctor/onboarding",{}],["GET","/doctor/practice/professional-profile"],["GET","/doctor/practice/verification"],["GET","/doctor/documents"],["GET","/doctor/practice/overview"],["GET","/doctor/practice/analytics"],["GET","/doctor/command-center"],["GET","/doctor/appointments"],["GET","/doctor/prescriptions"],["GET","/doctor/dashboard"]];
for (const [method, path, body] of list) {
  const r = await api(method, path, { token: d.token, body });
  console.log(method.padEnd(4), path.padEnd(42), r.status, (r.json?.message||"").slice(0,70));
}
await m.disconnect();
