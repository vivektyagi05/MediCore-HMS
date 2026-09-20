import { dbConnect } from "./lib.mjs";
const m = await dbConnect(); const db = m.connection.db;
const c = async (col, q = {}) => db.collection(col).countDocuments(q);
console.log(JSON.stringify({
  masterData: { states: await c("masterdatas", { kind: "state" }), districts: await c("masterdatas", { kind: "district" }), cities: await c("masterdatas", { kind: "city" }), specializations: await c("masterdatas", { kind: "specialization" }) },
  services: await c("services"), articles: await c("cmspages", { contentType: "article" }), doctors: await c("doctors"), users: await c("users"),
  doctorsByStatus: { pending: await c("doctors", { verificationStatus: "pending" }), approved: await c("doctors", { verificationStatus: "approved" }), rejected: await c("doctors", { verificationStatus: "rejected" }) },
}));
await m.disconnect();
