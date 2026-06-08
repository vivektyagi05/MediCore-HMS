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
      getCache.set(key, {
        response,
        expiresAt: Date.now() + (config.cacheTtlMs ?? GET_CACHE_TTL_MS),
      });
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

export const getApiErrorMessage = (error) => {
  if (error.response?.data?.message) return error.response.data.message;
  if (error.code === "ECONNABORTED") return "The request timed out. Please try again.";
  if (!error.response) return "Unable to reach the HMS server. Check your connection.";
  return "Something went wrong. Please try again.";
};

export default apiClient;
