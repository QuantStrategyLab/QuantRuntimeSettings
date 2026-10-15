import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../i18n";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts(current => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 6000);
  }, []);

  const dismiss = (id: number) => setToasts(current => current.filter(item => item.id !== id));

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.kind === "info" ? "" : toast.kind}`}>
            <span style={{ flex: 1 }}>{toast.text}</span>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t("common.close")}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
