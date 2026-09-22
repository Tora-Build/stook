import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EXPLORER } from "../lib/config";

interface Toast { id: number; kind: "ok" | "err"; text: string; sig?: string }
const Ctx = createContext<{ ok: (t: string, sig?: string) => void; err: (t: string) => void }>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.kind === "ok" ? 6000 : 9000);
  }, []);
  const api = useMemo(() => ({ ok: (text: string, sig?: string) => push({ kind: "ok", text, sig }), err: (text: string) => push({ kind: "err", text }) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.sig && <a href={EXPLORER("tx", t.sig)} target="_blank" rel="noreferrer">view</a>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
