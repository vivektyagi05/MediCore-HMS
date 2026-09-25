import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

const GET_CACHE_TTL_MS = 2000;
const pendingGets = new Map();
const getCache = new Map();

const stableSerialize = (value) => {
  if (!value) return "";
  if (value instanceof URLSearchParams) return value.toString();
  if (typeof value !== "object") return String(value);

  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
          acc[key] = value[key];
        }
        return acc;
      }, {}),
  );
};

const getRequestKey = (url, config = {}) => {
  const token = localStorage.getItem("hms_token") || "";
  return `${token}:${url}:${stableSerialize(config.params)}`;
};

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("hms_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("hms_token");
      localStorage.removeItem("hms_user");
      pendingGets.clear();
      getCache.clear();
      window.dispatchEvent(new Event("hms:unauthorized"));
    }

    return Promise.reject(error);
  },
);

const rawGet = apiClient.get.bind(apiClient);

apiClient.get = (url, config = {}) => {
  if (config.responseType === "blob" || config.dedupe === false) {
    return rawGet(url, config);
  }

  const key = getRequestKey(url, config);
  const cached = getCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.response);
  }

  if (pendingGets.has(key)) {
    return pendingGets.get(key);
  }

  const request = rawGet(url, config)
    .then((response) => {
      // Some endpoints (e.g. master-data lists) are only meaningfully empty
      // once — after a not-yet-imported/backfilled dataset is populated, an
      // empty response cached here would keep hiding the real data for up to
      // cacheTtlMs even though the server now has it. `shouldCache` lets a
      // caller opt out of caching such "empty" responses; everything else is
      // cached as before.
      if (!config.shouldCache || config.shouldCache(response)) {
        getCache.set(key, {
          response,
          expiresAt: Date.now() + (config.cacheTtlMs ?? GET_CACHE_TTL_MS),
        });
      }
      return response;
    })
    .finally(() => {
      pendingGets.delete(key);
    });

  pendingGets.set(key, request);
  return request;
};

export const clearApiGetCache = () => {
  pendingGets.clear();
  getCache.clear();
};

["post", "put", "patch", "delete"].forEach((method) => {
  const rawMutation = apiClient[method].bind(apiClient);
  apiClient[method] = (...args) =>
    rawMutation(...args).finally(() => {
      clearApiGetCache();
    });
});

// ERROR UX REQUIREMENT (Appointment Regression Repair): the backend's
// errorMiddleware already computes a useful, safe `details` object for
// validation failures (per-field messages — see errorMiddleware.js and
// validateAppointmentCreate) but this function only ever read `message`,
// so every validation failure surfaced to the user as the generic
// "Validation failed" with the actual reason silently discarded. `details`
// is deliberately narrow here: only plain string values (real validation
// messages) are ever shown — an object value (e.g. { code: "SLOT_CONFLICT" },
// { governance }, { failedControls: [...] }) is a structured payload for
// the calling code to branch on, not user-facing text, and is left alone
// so this never leaks anything beyond what a validator author wrote as a
// message.
export const getApiErrorMessage = (error) => {
  const data = error.response?.data;
  if (data?.details && typeof data.details === "object" && !Array.isArray(data.details)) {
    const detailMessages = Object.entries(data.details)
      .filter(([key, value]) => key !== "code" && typeof value === "string")
      .map(([, value]) => value);
    if (detailMessages.length > 0) return detailMessages.join(" ");
  }
  if (data?.message) return data.message;
  if (error.code === "ECONNABORTED") return "The request timed out. Please try again.";
  if (!error.response) return "Unable to reach the HMS server. Check your connection.";
  return "Something went wrong. Please try again.";
};

export default apiClient;
