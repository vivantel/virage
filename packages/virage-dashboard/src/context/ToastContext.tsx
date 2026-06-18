import { createContext, useContext, useRef, type ReactNode } from "react";
import { Toast, type ToastMessage } from "primereact/toast";

interface ToastContextValue {
  showError: (summary: string, detail?: string) => void;
  showSuccess: (summary: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showError: () => undefined,
  showSuccess: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const toastRef = useRef<Toast>(null);

  const show = (msg: ToastMessage) => toastRef.current?.show(msg);

  return (
    <ToastContext.Provider
      value={{
        showError: (summary, detail) =>
          show({ severity: "error", summary, detail, life: 6000 }),
        showSuccess: (summary, detail) =>
          show({ severity: "success", summary, detail, life: 3000 }),
      }}
    >
      <Toast ref={toastRef} />
      {children}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
