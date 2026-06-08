import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/authApi";

const AuthContext = createContext(null);

const TOKEN_KEY = "hms_token";
const USER_KEY = "hms_user";

export const roleDashboardPath = (role) => {
  if (role === "admin" || role === "super_admin") return "/admin/dashboard";
  if (role === "doctor") {
  const user = JSON.parse(
    localStorage.getItem("hms_user") || "{}"
  );

  if (
    user.doctorOnboardingStatus !==
    "approved"
  ) {
    return "/doctor/onboarding";
  }

  return "/doctor/dashboard";
}
  if (role === "patient") return "/patient/dashboard";
  return "/login";
};

const readStoredUser = () => {
  try {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));

  const persistSession = useCallback((authPayload) => {
    localStorage.setItem(TOKEN_KEY, authPayload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(authPayload.user));
    setToken(authPayload.token);
    setUser(authPayload.user);
    return authPayload.user;
  }, []);

  const login = useCallback(
    async (credentials) => {
      const response = await authApi.login(credentials);
      return persistSession(response.data);
    },
    [persistSession],
  );

  const register = useCallback(
    async (payload) => {
      const response = await authApi.register(payload);
      return persistSession(response.data);
    },
    [persistSession],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener("hms:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("hms:unauthorized", handleUnauthorized);
  }, [logout]);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      role: user?.role,
      login,
      register,
      logout,
      isAdmin: user?.role === "admin" || user?.role === "super_admin",
      isDoctor: user?.role === "doctor",
      isPatient: user?.role === "patient",
    }),
    [user, token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
};
