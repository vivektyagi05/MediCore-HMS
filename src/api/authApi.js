import apiClient from "./axios";

export const authApi = {
  login(credentials) {
    return apiClient.post("/auth/login", credentials).then((res) => res.data);
  },
  register(payload) {
    return apiClient.post("/auth/register", payload).then((res) => res.data);
  },
  verifyEmail(token) {
    return apiClient.post("/auth/verify-email", { token }).then((res) => res.data);
  },
  resendVerification(email) {
    return apiClient.post("/auth/resend-verification", { email }).then((res) => res.data);
  },
  // Phase P15 — password recovery. Also used as the "resend code" action:
  // calling it again with the same email simply supersedes the previous
  // OTP (see backend CHANGELOG-PHASE-P15).
  forgotPassword(payload) {
    return apiClient.post("/auth/forgot-password", payload).then((res) => res.data);
  },
  verifyPasswordResetOtp(payload) {
    return apiClient.post("/auth/verify-password-reset-otp", payload).then((res) => res.data);
  },
  resetPassword(payload) {
    return apiClient.post("/auth/reset-password", payload).then((res) => res.data);
  },
  // PHASE 2-A — session restoration. Re-verifies the token against the
  // backend and returns the current user document, so cached fields like
  // `doctorOnboardingStatus` can never go stale for the lifetime of a
  // session.
  me() {
    return apiClient.get("/auth/me", { dedupe: false }).then((res) => res.data);
  },
};
