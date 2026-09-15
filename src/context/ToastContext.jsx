import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "success") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      success: (message) => showToast(message, "success"),
      error: (message) => showToast(message, "error"),
      warning: (message) => showToast(message, "warning"),
      info: (message) => showToast(message, "info"),
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[70] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3">
        {toasts.map((toast) => {
          const isError = toast.type === "error";
          const isWarning = toast.type === "warning";
          const Icon = isError ? XCircle : isWarning ? AlertTriangle : CheckCircle2;

          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-card border p-4 shadow-elevated ${
                isError
                  ? "border-rose-200 bg-white text-rose-700"
                  : isWarning
                    ? "border-amber-200 bg-white text-amber-800"
                    : "border-emerald-200 bg-white text-emerald-700"
              }`}
            >
              <Icon className="mt-0.5 shrink-0" size={20} />
              <p className="flex-1 text-sm font-bold leading-5">{toast.message}</p>
              <button onClick={() => removeToast(toast.id)} aria-label="Dismiss notification">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
};
