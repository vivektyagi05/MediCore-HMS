// In-memory stand-in for the Mongoose model statics the Phase 01 payment code
// uses. It evaluates the REAL filters/updates the production code sends
// (equality, $in/$nin/$ne/$lt/$exists/$not/$elemMatch/$or/$and; $set/$unset/
// $push/$inc) and enforces the unique indexes the schemas declare.
//
// LEVEL OF EVIDENCE: this proves the APPLICATION logic (compare-and-set
// semantics, fencing, idempotency) including interleavings: every operation
// yields to the event loop before it runs, so two async flows genuinely
// interleave between a read and the conditional write. It does NOT prove
// MongoDB's own atomicity or index behaviour; tests/mongo/phase01.mongo.test.mjs
// covers that against a real mongod (BLOCKED where none is available).
import mongoose from "mongoose";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const isId = (v) => v && typeof v === "object" && typeof v.toHexString === "function";
const norm = (v) => (isId(v) ? v.toHexString() : v instanceof Date ? v.getTime() : v);
const eqv = (a, b) => {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  return norm(a) === norm(b);
};
const clone = (v) => {
  if (v === null || typeof v !== "object" || isId(v)) return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = clone(val);
  return out;
};
const getPath = (doc, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
const setPath = (doc, path, value) => {
  const keys = path.split(".");
  let o = doc;
  for (let i = 0; i < keys.length - 1; i += 1) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
};
const unsetPath = (doc, path) => {
  const keys = path.split(".");
  let o = doc;
  for (let i = 0; i < keys.length - 1; i += 1) { if (o == null) return; o = o[keys[i]]; }
  if (o) delete o[keys[keys.length - 1]];
};

const matchValue = (docVal, cond) => {
  if (cond instanceof RegExp) return typeof docVal === "string" && cond.test(docVal);
  if (cond && typeof cond === "object" && !isId(cond) && !(cond instanceof Date) && !Array.isArray(cond)
      && Object.keys(cond).some((k) => k.startsWith("$"))) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case "$in": return arg.some((x) => (Array.isArray(docVal) ? docVal.some((d) => eqv(d, x)) : eqv(docVal, x)));
        case "$nin": return !arg.some((x) => eqv(docVal, x));
        case "$ne": return !eqv(docVal, arg);
        case "$lt": return docVal != null && norm(docVal) < norm(arg);
        case "$lte": return docVal != null && norm(docVal) <= norm(arg);
        case "$gt": return docVal != null && norm(docVal) > norm(arg);
        case "$gte": return docVal != null && norm(docVal) >= norm(arg);
        case "$exists": return (docVal !== undefined) === Boolean(arg);
        case "$regex": return typeof docVal === "string" && new RegExp(arg).test(docVal);
        case "$not": return !matchValue(docVal, arg);
        case "$elemMatch": return Array.isArray(docVal) && docVal.some((el) => matchDoc(el, arg));
        default: throw new Error(`memoryModels: unsupported operator ${op}`);
      }
    });
  }
  if (Array.isArray(docVal) && !Array.isArray(cond)) return docVal.some((d) => eqv(d, cond));
  return eqv(docVal, cond);
};
const matchDoc = (doc, filter = {}) =>
  Object.entries(filter).every(([key, cond]) => {
    if (key === "$and") return cond.every((f) => matchDoc(doc, f));
    if (key === "$or") return cond.some((f) => matchDoc(doc, f));
    return matchValue(getPath(doc, key), cond);
  });

const applyUpdate = (doc, update) => {
  for (const [k, v] of Object.entries(update.$set || {})) if (v !== undefined) setPath(doc, k, v);
  for (const k of Object.keys(update.$unset || {})) unsetPath(doc, k);
  for (const [k, v] of Object.entries(update.$push || {})) { const arr = getPath(doc, k) || []; arr.push(clone(v)); setPath(doc, k, arr); }
  for (const [k, v] of Object.entries(update.$inc || {})) setPath(doc, k, (getPath(doc, k) || 0) + v);
};

class Query {
  constructor(exec) { this._exec = exec; this._lean = false; this._sort = null; this._limit = null; }
  select() { return this; }
  populate() { return this; }
  lean() { this._lean = true; return this; }
  sort(s) { this._sort = s; return this; }
  limit(n) { this._limit = n; return this; }
  then(res, rej) { return this._exec(this).then(res, rej); }
  catch(rej) { return this.then(undefined, rej); }
}

export const installMemoryModels = (specs) => {
  const collections = new Map();
  const restore = [];
  const fail11000 = (keyPattern) => { const e = new Error(`E11000 duplicate key ${JSON.stringify(keyPattern)}`); e.code = 11000; e.keyPattern = keyPattern; return e; };

  for (const { model, unique = [] } of specs) {
    const store = new Map();
    collections.set(model.modelName, store);
    const all = () => [...store.values()];
    const checkUnique = (candidate, exceptId) => {
      for (const u of unique) {
        if (u.when && !u.when(candidate)) continue;
        const clash = all().find((o) => String(o._id) !== String(exceptId) && (!u.when || u.when(o)) && u.fields.every((f) => eqv(getPath(o, f), getPath(candidate, f))));
        if (clash) throw fail11000(Object.fromEntries(u.fields.map((f) => [f, 1])));
      }
    };
    const out = (obj, q) => (obj == null ? null : q._lean ? clone(obj) : model.hydrate(clone(obj)));
    const sorted = (rows, q) => {
      if (!q._sort) return rows;
      const [[field, dir]] = Object.entries(q._sort);
      return [...rows].sort((a, b) => (norm(getPath(a, field)) > norm(getPath(b, field)) ? 1 : -1) * (dir < 0 ? -1 : 1));
    };
    const patch = (name, fn) => { const prev = model[name]; model[name] = fn; restore.push(() => { model[name] = prev; }); };

    patch("create", async (data) => {
      await tick();
      const list = Array.isArray(data) ? data : [data];
      const created = [];
      for (const d of list) {
        const doc = new model(d);
        await doc.validate();
        const obj = doc.toObject({ depopulate: true });
        checkUnique(obj, obj._id);
        store.set(String(obj._id), clone(obj));
        created.push(model.hydrate(clone(obj)));
      }
      return Array.isArray(data) ? created : created[0];
    });
    patch("findOne", (filter = {}) => new Query(async (q) => { await tick(); return out(sorted(all().filter((o) => matchDoc(o, filter)), q)[0], q); }));
    patch("findById", (id) => new Query(async (q) => { await tick(); return out(store.get(String(id)), q); }));
    patch("find", (filter = {}) => new Query(async (q) => {
      await tick();
      let rows = sorted(all().filter((o) => matchDoc(o, filter)), q);
      if (q._limit) rows = rows.slice(0, q._limit);
      return rows.map((o) => out(o, q));
    }));
    patch("countDocuments", async (filter = {}) => { await tick(); return all().filter((o) => matchDoc(o, filter)).length; });
    patch("findOneAndUpdate", (filter, update, opts = {}) => new Query(async (q) => {
      await tick();
      const found = all().find((o) => matchDoc(o, filter));
      if (!found) return null;
      const before = clone(found);
      const next = clone(found);
      applyUpdate(next, update);
      checkUnique(next, next._id);
      store.set(String(next._id), next);
      return out(opts.returnDocument === "after" || opts.new ? next : before, q);
    }));
    const updateOneLike = (many) => async (filter, update) => {
      await tick();
      const rows = all().filter((o) => matchDoc(o, filter));
      const targets = many ? rows : rows.slice(0, 1);
      for (const t of targets) { const next = clone(t); applyUpdate(next, update); checkUnique(next, next._id); store.set(String(next._id), next); }
      return { matchedCount: targets.length, modifiedCount: targets.length };
    };
    patch("updateOne", updateOneLike(false));
    patch("updateMany", updateOneLike(true));
  }
  return {
    collections,
    dump: (name) => [...collections.get(name).values()].map(clone),
    reset: () => { for (const s of collections.values()) s.clear(); },
    restore: () => restore.reverse().forEach((r) => r()),
  };
};

export const newId = () => new mongoose.Types.ObjectId();
