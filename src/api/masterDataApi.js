import apiClient from "./axios";

export const masterDataApi = {
  getSpecializations: () => apiClient.get("/master-data/specializations", { cacheTtlMs: 300000 }).then((r) => r.data),
  getStates: () => apiClient.get("/master-data/states", { cacheTtlMs: 300000 }).then((r) => r.data),
  getDistricts: (stateId) => apiClient.get("/master-data/districts", { params: { parent: stateId }, cacheTtlMs: 300000 }).then((r) => r.data),
  getCities: (districtId) => apiClient.get("/master-data/cities", { params: { parent: districtId }, cacheTtlMs: 300000 }).then((r) => r.data),
};
