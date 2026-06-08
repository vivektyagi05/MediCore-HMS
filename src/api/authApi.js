import apiClient from "./axios";

export const authApi = {
  login(credentials) {
    return apiClient.post("/auth/login", credentials).then((res) => res.data);
  },
  register(payload) {
    return apiClient.post("/auth/register", payload).then((res) => res.data);
  },
};
