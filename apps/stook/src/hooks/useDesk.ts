// The call being made on the tower, and what it takes to change it: the
// kind, the call, a first end waiting for its second, one step of Undo and
// the line the readout says about the last change.
import { useCallback, useMemo, useState } from "react";
import { between, clamp, nearAt, same, span, type Call, type Grid, type Kind } from "../lib/call";

export interface DeskState {
  kind: Kind;
  call: Call | null;
  /** A between call's first end, as the floors of its row, waiting for the other end. */
  pending: { a: number; b: number } | null;
  undo: { call: Call | null } | null;
  msg: string;
  /** The last "how sure" used: ± floors of a near call. */
  lastS: number;
  /** A "how sure" being looked at (hovered or focused), drawn on the tower without changing the call. */
  peek: number | null;
}

export interface Desk extends DeskState {
  set: (call: Call | null, o?: { undoable?: boolean; msg?: string }) => void;
  /** A change while dragging: no Undo, the message only. */
  drag: (call: Call, msg?: string) => void;
  startPending: (a: number, b: number) => void;
  cancelPending: () => void;
  clear: () => void;
  undoIt: () => void;
  load: (call: Call | null) => void;
  switchKind: (k: Kind) => void;
  setSure: (s: number, at: number) => void;
  setMsg: (msg: string) => void;
  setPeek: (s: number | null) => void;
}

export function useDesk(grid: Grid | null): Desk {
  const [st, setSt] = useState<DeskState>({ kind: "near", call: null, pending: null, undo: null, msg: "", lastS: 3, peek: null });
  const set = useCallback((call: Call | null, o: { undoable?: boolean; msg?: string } = {}) => setSt((p) => ({
    ...p, call, pending: null, kind: call?.kind ?? p.kind, lastS: call?.kind === "near" ? call.s : p.lastS, msg: o.msg ?? "",
    undo: o.undoable && p.call && !same(p.call, call) ? { call: p.call } : null,
  })), []);
  const drag = useCallback((call: Call, msg = "") => setSt((p) => ({ ...p, call, pending: null, kind: call.kind, lastS: call.kind === "near" ? call.s : p.lastS, undo: null, msg })), []);
  const startPending = useCallback((a: number, b: number) => setSt((p) => ({ ...p, kind: "between", pending: { a, b }, undo: p.call ? { call: p.call } : null, call: between(a, b), msg: "" })), []);
  const cancelPending = useCallback(() => setSt((p) => ({ ...p, pending: null, call: p.undo ? p.undo.call : null, kind: p.undo?.call?.kind ?? p.kind, undo: null, msg: "" })), []);
  const clear = useCallback(() => setSt((p) => ({ ...p, pending: null, call: null, undo: p.call ? { call: p.call } : null, msg: "" })), []);
  const undoIt = useCallback(() => setSt((p) => (p.undo ? { ...p, call: p.undo.call, kind: p.undo.call?.kind ?? p.kind, undo: null, pending: null, msg: "" } : p)), []);
  const load = useCallback((call: Call | null) => setSt((p) => ({ ...p, call, kind: call?.kind ?? p.kind, lastS: call?.kind === "near" ? call.s : p.lastS, pending: null, undo: null, msg: "" })), []);
  const setMsg = useCallback((msg: string) => setSt((p) => ({ ...p, msg })), []);
  const setPeek = useCallback((peek: number | null) => setSt((p) => (p.peek === peek ? p : { ...p, peek })), []);
  const switchKind = useCallback((k: Kind) => setSt((p) => {
    if (p.kind === k || !grid) return p;
    const c = p.call;
    if (!c || p.pending) return { ...p, kind: k, pending: null, call: p.pending ? null : c, msg: "" };
    if (k === "between") { const [a, b] = span(c); return { ...p, kind: k, call: between(a, b), undo: null, msg: "Same floors, now the same pay on each." }; }
    if (c.kind !== "between") return p;
    const mid = Math.round((c.lo + c.hi) / 2), s = clamp(Math.ceil((c.hi - c.lo) / 2), 1, 7), n = nearAt(grid, mid, s);
    return { ...p, kind: k, call: n, lastS: n.kind === "near" ? n.s : p.lastS, undo: null, msg: `Now pays most on the middle floor.${c.hi - c.lo > 14 ? " A near call covers 15 floors at most." : ""}` };
  }), [grid]);
  const setSure = useCallback((s: number, at: number) => setSt((p) => {
    if (!grid) return p;
    const lastS = clamp(s, 1, 7);
    if (p.call?.kind === "near") return { ...p, lastS, call: nearAt(grid, p.call.c, lastS), msg: "", undo: null };
    if (p.kind === "near" && !p.call) return { ...p, lastS, call: nearAt(grid, at, lastS), msg: "" };
    return { ...p, lastS };
  }), [grid]);
  return useMemo(() => ({ ...st, set, drag, startPending, cancelPending, clear, undoIt, load, switchKind, setSure, setMsg, setPeek }), [st, set, drag, startPending, cancelPending, clear, undoIt, load, switchKind, setSure, setMsg, setPeek]);
}
