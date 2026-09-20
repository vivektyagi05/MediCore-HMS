// Stand-in for src/api/masterDataApi.js: same contract, but talks to the REAL backend/DB.
let calls = [];
export const __calls = calls;
const unwrap = (json) => (Array.isArray(json?.data) ? json.data : []);
const get = async (path, params, delayMs = 0) => {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`http://127.0.0.1:5000/api${path}${qs}`);
  const json = await res.json();
  calls.push({ path, params, status: res.status, n: unwrap(json).length });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return unwrap(json);
};
export const masterDataApi = {
  getSpecializations: () => get("/master-data/specializations"),
  getStates: () => get("/master-data/states"),
  // Rajasthan's response is deliberately slow to prove the latest selection wins.
  getDistricts: (id) => (!id ? Promise.resolve([]) : get("/master-data/districts", { parent: id }, globalThis.__slowState === id ? 800 : 0)),
  getCities: (id) => (!id ? Promise.resolve([]) : get("/master-data/cities", { parent: id })),
};
