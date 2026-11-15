/**
 * Internet Independence Mode — client side.
 *
 * - Queue: supported changes made while offline are stored on this device (cleared on sign-out) with a unique
 *   client operation id, then replayed through POST /sync/batch when connectivity returns. The
 *   server applies each id at most once, so retries are safe.
 * - Essentials cache (opt-in, per device): today's schedule, profiles, appointments and emergency
 *   cards are kept so they can be read offline. Cleared on sign-out.
 */
import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";

export type OfflineOpType = "dose.record" | "note.create" | "task.complete" | "wellness.checkin";
export interface OfflineOp {
  clientOpId: string;
  type: OfflineOpType;
  householdId: string;
  seniorId: string | null;
  clientTimestamp: string;
  payload: Record<string, unknown>;
  label: string;
}
export interface SyncResult { clientOpId: string; status: "applied" | "conflict" | "rejected"; message: string; duplicate?: boolean }

const QKEY = "carehub.offlineQueue";
const RKEY = "carehub.offlineResults";
const EKEY = "carehub.offlineEssentials";
const CKEY = "carehub.offlineCache";
const listeners = new Set<() => void>();

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function getQueue(): OfflineOp[] {
  return safe(() => JSON.parse(localStorage.getItem(QKEY) || "[]"), []);
}
function setQueue(q: OfflineOp[]) {
  safe(() => localStorage.setItem(QKEY, JSON.stringify(q)), undefined);
  listeners.forEach((l) => l());
}
export function getLastResults(): SyncResult[] {
  return safe(() => JSON.parse(localStorage.getItem(RKEY) || "[]"), []);
}
export function clearResults() {
  safe(() => localStorage.removeItem(RKEY), undefined);
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function enqueue(op: Omit<OfflineOp, "clientOpId" | "clientTimestamp">) {
  const full: OfflineOp = { ...op, clientOpId: crypto.randomUUID().replace(/-/g, ""), clientTimestamp: new Date().toISOString() };
  setQueue([...getQueue(), full]);
  return full;
}

/** True when an error means "we're offline" (so the change should be queued rather than lost). */
export function isOfflineError(e: unknown) {
  return (typeof navigator !== "undefined" && !navigator.onLine) || (e instanceof ApiError && e.code === "network_error");
}

let flushing: Promise<SyncResult[]> | null = null;
export function flush(): Promise<SyncResult[]> {
  if (flushing) return flushing;
  const q = getQueue();
  if (!q.length || (typeof navigator !== "undefined" && !navigator.onLine)) return Promise.resolve([]);
  flushing = api
    .post<{ results: SyncResult[] }>("/sync/batch", { ops: q.map(({ label: _l, ...o }) => o) })
    .then((r) => {
      const done = new Set(r.results.map((x) => x.clientOpId));
      setQueue(getQueue().filter((o) => !done.has(o.clientOpId)));
      const labelled = r.results.map((x) => ({ ...x, message: `${q.find((o) => o.clientOpId === x.clientOpId)?.label ?? "Change"}: ${x.message}` }));
      safe(() => localStorage.setItem(RKEY, JSON.stringify(labelled.filter((x) => x.status !== "applied"))), undefined);
      listeners.forEach((l) => l());
      return labelled;
    })
    .catch(() => [] as SyncResult[])
    .finally(() => { flushing = null; });
  return flushing;
}

// ---------------------------------------------------------------- essentials cache
export const essentialsEnabled = () => safe(() => localStorage.getItem(EKEY) === "on", false);
export function setEssentials(on: boolean) {
  safe(() => (on ? localStorage.setItem(EKEY, "on") : (localStorage.removeItem(EKEY), localStorage.removeItem(CKEY))), undefined);
}

/** Which cached queries count as "essentials" for offline reading. */
function ESSENTIAL(key: readonly unknown[]): boolean {
  const k = key.map(String);
  if (k[0] === "me") return k.length === 1;                                   // profile + memberships
  if (k[0] !== "households") return false;
  if (k.length === 1) return true;                                            // household list
  if (k[2] === "appts") return true;                                          // upcoming appointments
  if (k[2] === "seniors" && k.length === 3) return true;                      // profile list
  return k[2] === "seniors" && ["doses", "emergency"].includes(k[4] ?? "");   // today's doses, emergency card
}

export function persistEssentials(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return qc.getQueryCache().subscribe(() => {
    if (!essentialsEnabled()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const entries = qc.getQueryCache().getAll().filter((q) => q.state.status === "success" && ESSENTIAL(q.queryKey))
        .map((q) => [q.queryKey, q.state.data, q.state.dataUpdatedAt]);
      safe(() => localStorage.setItem(CKEY, JSON.stringify(entries.slice(0, 60))), undefined);
    }, 1000);
  });
}

export function hydrateEssentials(qc: QueryClient) {
  if (!essentialsEnabled()) return;
  const entries: [unknown[], unknown, number][] = safe(() => JSON.parse(localStorage.getItem(CKEY) || "[]"), []);
  for (const [key, data, at] of entries) qc.setQueryData(key, data, { updatedAt: at });
}

export function clearOfflineData() {
  for (const k of [QKEY, RKEY, CKEY]) safe(() => localStorage.removeItem(k), undefined);
}
