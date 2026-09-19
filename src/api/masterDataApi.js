import apiClient from "./axios";

const unwrapList = (response) => {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
};

export const masterDataApi = {
  getSpecializations: () => apiClient.get("/master-data/specializations", { cacheTtlMs: 300000 }).then(unwrapList),
  getStates: () => apiClient.get("/master-data/states", { cacheTtlMs: 300000 }).then(unwrapList),
  getDistricts: (stateId) => apiClient.get("/master-data/districts", { params: { parent: stateId }, cacheTtlMs: 300000 }).then(unwrapList),
  getCities: (districtId) => apiClient.get("/master-data/cities", { params: { parent: districtId }, cacheTtlMs: 300000 }).then(unwrapList),
};
