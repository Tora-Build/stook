// A notice on the floor: a pixel sign on the left says what kind (info,
// heads up, stop), a short title, one or two plain sentences.
import type { ReactNode } from "react";

const SIGN = { info: "i", warn: "!", stop: "×" } as const;

export function Notice(p: { tone: keyof typeof SIGN; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`notice notice-${p.tone} ${p.className ?? ""}`} role={p.tone === "stop" ? "alert" : "note"}>
      <span className="notice-sign" aria-hidden="true">{SIGN[p.tone]}</span>
      <div className="notice-body"><b>{p.title}</b><span>{p.children}</span></div>
    </div>
  );
}
