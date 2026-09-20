import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { RealtimeProvider } from "./context/RealtimeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { I18nProvider } from "./i18n/I18nContext.jsx";
import "./index.css";

// Diagnostic only (no secrets): which build is this, and which API host does it call?
try {
  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
  const info = { ...__MEDICORE_BUILD__, apiHost: new URL(apiBase, window.location.origin).host, apiConfigured: Boolean(import.meta.env.VITE_API_BASE_URL) };
  window.__MEDICORE_BUILD__ = info;
  const meta = document.createElement("meta");
  meta.name = "medicore-build";
  meta.content = `${info.version}@${info.builtAt};api=${info.apiHost}`;
  document.head.appendChild(meta);
  if (import.meta.env.PROD && !info.apiConfigured) {
    console.error("MediCore: VITE_API_BASE_URL was not set at build time; this build calls", info.apiHost);
  }
} catch { /* diagnostics must never break the app */ }

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <RealtimeProvider>
              <App />
            </RealtimeProvider>
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
