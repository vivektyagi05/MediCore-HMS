// Minimal in-memory stand-in for a native MongoDB Db, just enough surface for
// the index migration + migration-state logic. It models the server rules the
// migration relies on: same-name/different-options is rejected, unique index
// builds fail on duplicates, _id uniqueness gives E11000. It is UNIT evidence
// of our logic only -- real index behaviour is checked by tests/mongo/*.
const typeOf = (v) => (v === null ? "null" : v && v._isObjectId ? "objectId" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const matchesCond = (doc, filter) => {
  if (filter.$or) return filter.$or.some((f) => matchesCond(doc, f));
  return Object.entries(filter).every(([field, cond]) => {
    const present = Object.prototype.hasOwnProperty.call(doc, field);
    const value = doc[field];
    if (cond && typeof cond === "object" && !cond._isObjectId && !Array.isArray(cond)) {
      if ("$exists" in cond) return present === cond.$exists;
      if ("$type" in cond) return present && typeOf(value) === cond.$type;
    }
    if (cond === null) return !present || value === null;
    return eq(value, cond);
  });
};

export const oid = (s) => ({ _isObjectId: true, toString: () => s, toJSON: () => `oid:${s}` });

export function createFakeDb({ failCreateFor = [] } = {}) {
  const collections = new Map();
  const get = (name) => {
    if (!collections.has(name)) collections.set(name, { docs: [], indexes: [{ v: 2, key: { _id: 1 }, name: "_id_" }], exists: false });
    return collections.get(name);
  };
  const uniqueViolations = (c, key, options) => {
    const fields = Object.keys(key);
    const seen = new Set();
    for (const d of c.docs) {
      if (options.partialFilterExpression && !matchesCond(d, options.partialFilterExpression)) continue;
      if (options.sparse && !fields.some((f) => Object.prototype.hasOwnProperty.call(d, f))) continue;
      const k = JSON.stringify(fields.map((f) => d[f] ?? null));
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };
  return {
    _collections: collections,
    collection(name) {
      const c = get(name);
      return {
        async indexes() {
          if (!c.exists) { const e = new Error("ns does not exist"); e.code = 26; throw e; }
          return c.indexes.map((i) => ({ ...i }));
        },
        async createIndex(key, options = {}) {
          if (failCreateFor.includes(options.name)) { const e = new Error("simulated server refusal"); e.code = 67; e.codeName = "CannotCreateIndex"; throw e; }
          c.exists = true;
          const clash = c.indexes.find((i) => i.name === options.name);
          if (clash) {
            const same = eq(clash.key, key) && !!clash.unique === !!options.unique && !!clash.sparse === !!options.sparse && eq(clash.partialFilterExpression ?? null, options.partialFilterExpression ?? null);
            if (same) return options.name;
            const e = new Error(`An existing index has the same name as the requested index: ${options.name}`); e.code = 86; e.codeName = "IndexKeySpecsConflict"; throw e;
          }
          if (options.unique && uniqueViolations(c, key, options)) { const e = new Error("E11000 duplicate key error building index"); e.code = 11000; throw e; }
          c.indexes.push({ v: 2, key, name: options.name, ...options });
          return options.name;
        },
        aggregate(pipeline) {
          return {
            async toArray() {
              let rows = c.docs.slice();
              for (const stage of pipeline) {
                if (stage.$match && stage.$match.count) rows = rows.filter((g) => g.count > stage.$match.count.$gt);
                else if (stage.$match) rows = rows.filter((d) => matchesCond(d, stage.$match));
                else if (stage.$group) {
                  const groups = new Map();
                  for (const d of rows) {
                    const id = Object.fromEntries(Object.entries(stage.$group._id).map(([f, ref]) => [f, d[ref.slice(1)] ?? null]));
                    const k = JSON.stringify(id);
                    const g = groups.get(k) || { _id: id, count: 0, ids: [] };
                    g.count += 1; g.ids.push(d._id); groups.set(k, g);
                  }
                  rows = [...groups.values()];
                } else if (stage.$limit) rows = rows.slice(0, stage.$limit);
              }
              return rows;
            },
          };
        },
        async countDocuments(filter) { return c.docs.filter((d) => matchesCond(d, filter)).length; },
        async insertOne(doc) {
          if (c.docs.some((d) => d._id === doc._id)) { const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
          c.exists = true; c.docs.push({ ...doc }); return { insertedId: doc._id };
        },
        async findOne(filter) { return c.docs.find((d) => matchesCond(d, filter)) || null; },
        async updateOne(filter, update) {
          const doc = c.docs.find((d) => Object.entries(filter).every(([k, v]) => eq(d[k], v)));
          if (!doc) return { matchedCount: 0 };
          Object.assign(doc, update.$set || {}); return { matchedCount: 1 };
        },
        _seed(docs) { c.exists = true; c.docs.push(...docs); },
        _seedIndex(index) { c.exists = true; c.indexes.push(index); },
      };
    },
  };
}
