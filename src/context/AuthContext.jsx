import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/authApi";

const AuthContext = createContext(null);

const TOKEN_KEY = "hms_token";
const USER_KEY = "hms_user";

export const roleDashboardPath = (role) => {
  if (role === "super_admin") return "/admin/dashboard";
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
  // PHASE 2-A — Part 2 (session restoration). True only while the very
  // first /auth/me verification (on page load) is in flight. PrivateRoute
  // uses this to avoid making a routing decision off a cached user object
  // that may already be stale or revoked.
  const [initializing, setInitializing] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));

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
      return response.data.user;
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // PHASE 2-A — Part 2 (session restoration). Re-verifies the cached
  // session against the backend and refreshes the cached user document.
  // Exposed so any screen that just learned the account changed
  // server-side (e.g. after an admin approval notification) can pull the
  // latest state without forcing a logout/login cycle.
  const refreshUser = useCallback(async () => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) return null;
    try {
      const response = await authApi.me();
      const freshUser = response.data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      setUser(freshUser);
      return freshUser;
    } catch {
      // A failed /me call (expired/revoked/invalid token) already triggers
      // the axios 401 interceptor -> "hms:unauthorized" -> logout() below.
      // Nothing further to do here.
      return null;
    }
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener("hms:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("hms:unauthorized", handleUnauthorized);
  }, [logout]);

  // Runs once per app load (mount) — this is what makes "page refresh" and
  // "browser restart" real session restoration instead of blind trust in
  // whatever was last cached. A revoked/expired token is rejected by /me
  // and cleared via the unauthorized event; a valid token gets its user
  // document refreshed (fixing, e.g., a doctor's onboarding approval never
  // reaching a session that was opened before the approval happened).
  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setInitializing(false);
      return () => {
        isMounted = false;
      };
    }
    refreshUser().finally(() => {
      if (isMounted) setInitializing(false);
    });
    return () => {
      isMounted = false;
    };
    // Intentionally runs only on mount — token changes from login/register
    // already carry a fresh user via persistSession, and a token change to
    // null (logout) needs no re-verification.
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      initializing,
      role: user?.role,
      login,
      register,
      logout,
      refreshUser,
      isAdmin: user?.role === "super_admin",
      isDoctor: user?.role === "doctor",
      isPatient: user?.role === "patient",
    }),
    [user, token, initializing, login, register, logout, refreshUser],
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
