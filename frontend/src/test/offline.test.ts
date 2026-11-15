import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const post = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, api: { ...real.api, post: (...a: unknown[]) => post(...a) } };
});

import { ApiError } from "@/lib/api";
import {
  clearOfflineData, clearResults, enqueue, essentialsEnabled, flush, getLastResults, getQueue, hydrateEssentials,
  isOfflineError, persistEssentials, setEssentials, subscribe,
} from "@/lib/offline";

const dose = { type: "dose.record" as const, householdId: "h1", seniorId: "s1", label: "Metformin dose", payload: { status: "taken" } };

beforeEach(() => { localStorage.clear(); post.mockReset(); });
afterEach(() => vi.useRealTimers());

describe("offline queue (Internet Independence Mode)", () => {
  it("stores each change with a unique operation id and notifies subscribers", () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    const a = enqueue(dose);
    const b = enqueue(dose);
    off();
    expect(getQueue()).toHaveLength(2);
    expect(a.clientOpId).not.toBe(b.clientOpId);
    expect(a.clientOpId).toMatch(/^[0-9a-f]{32}$/);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("replays the queue once, keeps conflicts visible and drops applied changes", async () => {
    const a = enqueue(dose);
    const b = enqueue({ ...dose, label: "Aspirin dose" });
    post.mockResolvedValue({ results: [
      { clientOpId: a.clientOpId, status: "applied", message: "Recorded" },
      { clientOpId: b.clientOpId, status: "conflict", message: "Already recorded by Priya" },
    ] });
    const results = await flush();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] as [string, { ops: Record<string, unknown>[] }];
    expect(url).toBe("/sync/batch");
    expect(body.ops[0]).not.toHaveProperty("label");          // UI-only label never leaves the device
    expect(getQueue()).toEqual([]);
    expect(results.map((r) => r.status)).toEqual(["applied", "conflict"]);
    expect(getLastResults()).toEqual([{ clientOpId: b.clientOpId, status: "conflict", message: "Aspirin dose: Already recorded by Priya" }]);
    clearResults();
    expect(getLastResults()).toEqual([]);
  });

  it("de-duplicates concurrent flushes and keeps the queue if the network fails", async () => {
    enqueue(dose);
    post.mockRejectedValue(new ApiError(0, "network_error", "offline"));
    const [r1, r2] = await Promise.all([flush(), flush()]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(r1).toEqual([]);
    expect(r2).toEqual([]);
    expect(getQueue()).toHaveLength(1);                         // nothing lost
  });

  it("does nothing when the queue is empty", async () => {
    expect(await flush()).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it("recognises offline errors", () => {
    expect(isOfflineError(new ApiError(0, "network_error", "x"))).toBe(true);
    expect(isOfflineError(new ApiError(403, "forbidden", "x"))).toBe(false);
  });
});

describe("essentials cache", () => {
  it("is opt-in, caches only essential records, restores them and is wiped on sign-out", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    persistEssentials(qc);
    qc.setQueryData(["households", "h1", "seniors"], [{ id: "s1" }]);
    vi.advanceTimersByTime(1500);
    expect(localStorage.getItem("carehub.offlineCache")).toBeNull(); // not enabled yet

    setEssentials(true);
    expect(essentialsEnabled()).toBe(true);
    qc.setQueryData(["households", "h1", "seniors", "s1", "doses", "today"], [{ id: "d1" }]);
    qc.setQueryData(["households", "h1", "audit"], [{ id: "private-log" }]);   // not an essential
    vi.advanceTimersByTime(1500);

    const fresh = new QueryClient();
    hydrateEssentials(fresh);
    expect(fresh.getQueryData(["households", "h1", "seniors"])).toEqual([{ id: "s1" }]);
    expect(fresh.getQueryData(["households", "h1", "seniors", "s1", "doses", "today"])).toEqual([{ id: "d1" }]);
    expect(fresh.getQueryData(["households", "h1", "audit"])).toBeUndefined();

    enqueue(dose);
    clearOfflineData();
    expect(getQueue()).toEqual([]);
    expect(localStorage.getItem("carehub.offlineCache")).toBeNull();
    setEssentials(false);
    expect(essentialsEnabled()).toBe(false);
  });
});
