// Tiny, dependency-free helpers for admin controller tests. NOT a MongoDB emulator: it implements only the filter
// operators the admin slices use ($or/$and, $lte/$lt/$gt/$gte, $in/$nin, $ne, $exists, $eq, dotted paths) so a test can
// run the REAL filter objects a controller builds against a fixture. Real-database behaviour still needs `test:mongo`.
const getPath = (doc, path) => path.split(".").reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), doc);
const isNil = (v) => v === null || v === undefined;
const eq = (a, b) => (isNil(a) && isNil(b)) || String(a) === String(b);

function matchCondition(value, cond) {
  if (cond === null || typeof cond !== "object" || cond instanceof Date || Array.isArray(cond)) return eq(value, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case "$eq": return eq(value, arg);
      case "$ne": return !eq(value, arg);
      case "$lte": return !isNil(value) && value <= arg;
      case "$lt": return !isNil(value) && value < arg;
      case "$gte": return !isNil(value) && value >= arg;
      case "$gt": return !isNil(value) && value > arg;
      case "$in": return arg.some((candidate) => eq(value, candidate));
      case "$nin": return !arg.some((candidate) => eq(value, candidate));
      case "$exists": return arg ? value !== undefined : value === undefined;
      default: throw new Error(`miniMongo: unsupported operator ${op}`);
    }
  });
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return cond.some((f) => matches(doc, f));
    if (key === "$and") return cond.every((f) => matches(doc, f));
    return matchCondition(getPath(doc, key), cond);
  });
}

// Chainable stand-in for a Mongoose query over an in-memory array. Records sort/limit/skip/select for assertions.
export function fakeQuery(docs, filter, record = {}) {
  let rows = docs.filter((d) => matches(d, filter));
  const q = {
    populate: () => q,
    select: () => q,
    sort(spec) {
      record.sort = spec;
      const keys = Object.entries(spec);
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of keys) {
          const av = getPath(a, k); const bv = getPath(b, k);
          if (av < bv) return -dir; if (av > bv) return dir;
        }
        return 0;
      });
      return q;
    },
    skip(n) { record.skip = n; rows = rows.slice(n); return q; },
    limit(n) { record.limit = n; rows = rows.slice(0, n); return q; },
    lean: () => q,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return q;
}

export function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

// Runs an asyncHandler-wrapped controller and resolves { res, error }.
export async function callHandler(handler, req) {
  const res = fakeRes();
  let error;
  await handler({ query: {}, params: {}, body: {}, user: { _id: "admin1" }, ip: "127.0.0.1", ...req }, res, (e) => { error = e; });
  return { res, error };
}
