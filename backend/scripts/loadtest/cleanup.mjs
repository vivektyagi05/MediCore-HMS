// Scoped cleanup. A document is deleted ONLY if its _id is inside this run's deterministic
// ownership range for that collection (and, for users, its email is on the run's reserved
// domain). There is no unscoped delete, drop, or collection-wide cleanup anywhere.
import mongoose from "mongoose";
import { idRange } from "./ids.mjs";
import { kindOfCollection } from "./seeder.mjs";
import { MODEL_FILES } from "./db.mjs";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oid = (h) => new mongoose.Types.ObjectId(h);

export const ownedFilter = (plan, key) => {
  const { lo, hi } = idRange(plan.ns, kindOfCollection(key));
  const f = { _id: { $gte: oid(lo), $lte: oid(hi) } };
  if (key === "users") f.email = new RegExp(`^(admin|doctor|patient)-\\d{6}@${esc(plan.domain)}$`);
  return f;
};

export const runCleanup = async ({ plan, models, confirm }) => {
  const result = {};
  for (const key of Object.keys(MODEL_FILES).reverse()) { // dependents first
    const filter = ownedFilter(plan, key);
    const found = await models[key].countDocuments(filter);
    let deleted = 0;
    if (confirm && found > 0) deleted = (await models[key].deleteMany(filter)).deletedCount; // filter is never empty (guarded above)
    result[key] = { found, deleted };
  }
  return result;
};
