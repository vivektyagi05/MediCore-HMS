import apiClient from "./axios";

const unwrapList = (response) => {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
};

// Master-data lists (states/districts/cities/specializations) are expected to
// be non-empty once seeded. Caching a response that came back empty — e.g.
// requested before the LGD import ran, or right after a state/district was
// deactivated — would otherwise hide freshly-imported data from the current
// tab for up to 5 minutes. Only a genuinely non-empty list is cached.
const cacheOnlyNonEmpty = (response) => Array.isArray(response?.data?.data) && response.data.data.length > 0;

export const masterDataApi = {
  getSpecializations: () => apiClient.get("/master-data/specializations", { cacheTtlMs: 300000, shouldCache: cacheOnlyNonEmpty }).then(unwrapList),
  getStates: () => apiClient.get("/master-data/states", { cacheTtlMs: 300000, shouldCache: cacheOnlyNonEmpty }).then(unwrapList),
  getDistricts: (stateId) => (!stateId ? Promise.resolve([]) : apiClient.get("/master-data/districts", { params: { parent: stateId }, cacheTtlMs: 300000, shouldCache: cacheOnlyNonEmpty }).then(unwrapList)),
  getCities: (districtId) => (!districtId ? Promise.resolve([]) : apiClient.get("/master-data/cities", { params: { parent: districtId }, cacheTtlMs: 300000, shouldCache: cacheOnlyNonEmpty }).then(unwrapList)),
};
