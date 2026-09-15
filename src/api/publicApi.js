import apiClient from "./axios";

export const publicApi = {
  getHomeSeo: () => apiClient.get("/public/seo/home", { cacheTtlMs: 300000 }).then((r) => r.data),

  getHomeStats: () =>
    apiClient.get("/public/stats", { cacheTtlMs: 60000 }).then((r) => r.data),

  getFeaturedDoctors: () =>
    apiClient.get("/public/featured-doctors", { cacheTtlMs: 30000 }).then((r) => r.data),

  getSearchMeta: () =>
    apiClient.get("/public/search-meta", { cacheTtlMs: 60000 }).then((r) => r.data),

  getDoctorCoverage: (params = {}) =>
    apiClient.get("/public/doctor-coverage", { params, cacheTtlMs: 120000 }).then((r) => r.data),

  getNextAvailability: (doctorId, params = {}) =>
    apiClient.get("/public/next-availability", { params: { doctorId, ...params }, cacheTtlMs: 30000 }).then((r) => r.data),

  getDoctorAvailability: (doctorIds) =>
    apiClient.get("/public/doctor-availability", { params: { doctorIds: doctorIds.join(",") }, cacheTtlMs: 30000 }).then((r) => r.data),

  searchDoctors: (params = {}) =>
    apiClient.get("/public/doctors", { params }).then((r) => r.data),

  getDoctorProfile: (id) =>
    apiClient.get(`/public/doctors/${id}`).then((r) => r.data),

  getDoctorReviews: (id, params = {}) =>
    apiClient.get(`/public/doctors/${id}/reviews`, { params }).then((r) => r.data),

  getTestimonials: () =>
    apiClient.get("/public/testimonials", { cacheTtlMs: 30000 }).then((r) => r.data),

  getProfileStrength: () =>
    apiClient.get("/public/doctor/profile-strength").then((r) => r.data),

  getReputation: () =>
    apiClient.get("/public/doctor/reputation").then((r) => r.data),

  getSpecialties: () =>
    apiClient.get("/public/specialties", { cacheTtlMs: 60000 }).then((r) => r.data),

  getServices: (params = {}) =>
    apiClient.get("/public/services", { params }).then((r) => r.data),
  getService: (slug) => apiClient.get(`/public/services/${slug}`).then((r) => r.data),

  getServiceCategories: () =>
    apiClient.get("/public/services/categories").then((r) => r.data),

  getArticles: (params = {}) =>
    apiClient.get("/public/articles", { params }).then((r) => r.data),

  getArticle: (slug) =>
    apiClient.get(`/public/articles/${slug}`).then((r) => r.data),
  getArticleCategories: () => apiClient.get("/public/articles/categories").then((r) => r.data),

  getHospitalInfo: () =>
    apiClient.get("/public/hospital-info", { cacheTtlMs: 300000 }).then((r) => r.data),


  compareDoctors: (ids) =>
    apiClient.get("/public/doctors/compare", { params: { ids: ids.join(",") } }).then((r) => r.data),

  getSimilarDoctors: (id) =>
    apiClient.get(`/public/doctors/${id}/similar`).then((r) => r.data),
};
