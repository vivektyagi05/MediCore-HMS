// Live runtime verification harness. Requires a RUNNING backend (API_BASE) and the
// same database it uses (MONGO_URI) with LGD import + seed already applied:
//   npm run migrate:master-data:lgd && npm run seed
// Creates clearly-labelled development/test accounts (@medicore-dev.test) only;
// never real professionals. Run each script with `node scripts/runtime-verification/<name>.mjs`.
import "dotenv/config";
export const BASE = process.env.API_BASE || "http://127.0.0.1:5000/api";
export const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@hms.local";
export const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || "ChangeMe123!";
export const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
export const dbConnect = async () => {
  const { default: mongoose } = await import("mongoose");
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  return mongoose;
};
// Development/test fixtures ONLY (clearly marked @medicore-dev.test); never real professionals.
export const registerDevDoctor = async (mongoose, tag) => {
  const email = `dev-doctor-${tag}@medicore-dev.test`;
  const password = "DevTest#Pass12345";
  let r = await api("POST", "/auth/register", { body: { name: `DEV TEST Doctor ${tag}`, email, password, role: "doctor", acceptTerms: true, termsAccepted: true } });
  if (![200, 201, 409].includes(r.status)) throw new Error("register failed " + r.status + JSON.stringify(r.json));
  await mongoose.connection.db.collection("users").updateOne({ email }, { $set: { emailVerified: true } });
  const login = await api("POST", "/auth/login", { body: { email, password } });
  if (login.status !== 200) throw new Error("login failed " + login.status + JSON.stringify(login.json));
  return { email, password, token: login.json.data?.token || login.json.token, user: login.json.data?.user || login.json.user };
};
