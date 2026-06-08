import apiClient from "./axios";

export const adminApi = {
  getServices(params = {}) {
    return apiClient.get("/admin/services", { params }).then((res) => res.data);
  },
  createService(payload) {
    return apiClient.post("/admin/services", payload).then((res) => res.data);
  },
  updateService(id, payload) {
    return apiClient.put(`/admin/services/${id}`, payload).then((res) => res.data);
  },
  deleteService(id) {
    return apiClient.delete(`/admin/services/${id}`).then((res) => res.data);
  },
  getSettings() {
    return apiClient.get("/admin/settings").then((res) => res.data);
  },
  updateSettings(payload) {
    return apiClient.put("/admin/settings", payload).then((res) => res.data);
  },
  getPermissions() {
    return apiClient.get("/admin/permissions").then((res) => res.data);
  },
  updatePermissions(role, permissions) {
    return apiClient.put(`/admin/permissions/${role}`, { permissions }).then((res) => res.data);
  },
  getAdmins() {
    return apiClient.get("/admin/permissions/hierarchy/admins").then((res) => res.data);
  },
  updateAdminRole(id, role) {
    return apiClient.put(`/admin/permissions/hierarchy/admins/${id}`, { role }).then((res) => res.data);
  },
  getCMSPages(params = {}) {
    return apiClient.get("/admin/cms", { params }).then((res) => res.data);
  },
  saveCMSPage(payload) {
    return apiClient.post("/admin/cms", payload).then((res) => res.data);
  },
  updateCMSPage(id, payload) {
    return apiClient.put(`/admin/cms/${id}`, payload).then((res) => res.data);
  },
  deleteCMSPage(id) {
    return apiClient.delete(`/admin/cms/${id}`).then((res) => res.data);
  },
  getFeatures() {
    return apiClient.get("/admin/features").then((res) => res.data);
  },
  updateFeature(key, payload) {
    return apiClient.put(`/admin/features/${key}`, payload).then((res) => res.data);
  },
  getActivity(params = {}) {
    return apiClient.get("/admin/activity", { params }).then((res) => res.data);
  },
  exportData(params = {}) {
    return apiClient
      .get("/admin/exports", { params, responseType: "blob" })
      .then((res) => res.data);
  },
  getUsers(params = {}) {
    return apiClient
      .get("/admin/users", { params })
      .then((res) => res.data);
  },
  getUser(id) {
    return apiClient
    .get(`/admin/users/${id}`)
    .then((res) => res.data);
    },

    updateUser(id, payload) {
    return apiClient
    .put(
    `/admin/users/${id}`,
    payload
    )
    .then((res) => res.data);
    },

    deleteUser(id) {
    return apiClient
    .delete(
    `/admin/users/${id}`
    )
    .then((res) => res.data);
    },

    toggleUserStatus(id) {
    return apiClient
    .patch(
    `/admin/users/${id}/status`
    )
    .then((res) => res.data);
    },

};
