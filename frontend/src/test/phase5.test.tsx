import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureApi } from "@/lib/api";
import { clearOfflineData, enqueue, flush, getLastResults, getQueue, isOfflineError } from "@/lib/offline";
import { VoiceCompanion } from "@/features/phase5/components";
import { ApiError } from "@/lib/api";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  localStorage.clear();
  configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: () => {} });
});
afterEach(() => vi.restoreAllMocks());

describe("Internet Independence Mode — offline queue (Scenario G)", () => {
  it("queues offline changes, syncs them once, and surfaces conflicts", async () => {
    const a = enqueue({ type: "dose.record", householdId: "h1", seniorId: "s1", label: "Metformin dose", payload: { medicationId: "m1", scheduledFor: "x", status: "taken" } });
    const b = enqueue({ type: "note.create", householdId: "h1", seniorId: "s1", label: "Observation", payload: { text: "ok" } });
    expect(getQueue()).toHaveLength(2);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ results: [
      { clientOpId: a.clientOpId, status: "conflict", message: "Ravi recorded it as skipped later." },
      { clientOpId: b.clientOpId, status: "applied", message: "Observation saved." },
    ] }));
    const res = await flush();
    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body));
    expect(String(spy.mock.calls[0]![0])).toContain("/sync/batch");
    expect(body.ops.map((o: { clientOpId: string }) => o.clientOpId)).toEqual([a.clientOpId, b.clientOpId]);
    expect(body.ops[0].label).toBeUndefined();                     // labels stay on the device
    expect(res).toHaveLength(2);
    expect(getQueue()).toEqual([]);                                 // both processed (conflict resolved server-side)
    expect(getLastResults()[0]!.message).toContain("Metformin dose: Ravi recorded it");
  });

  it("keeps the queue when the network is still down", async () => {
    enqueue({ type: "note.create", householdId: "h1", seniorId: "s1", label: "Observation", payload: { text: "x" } });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await flush();
    expect(getQueue()).toHaveLength(1);
  });

  it("detects offline errors and clears data on sign-out", () => {
    expect(isOfflineError(new ApiError(0, "network_error", "x"))).toBe(true);
    expect(isOfflineError(new ApiError(403, "forbidden", "x"))).toBe(false);
    enqueue({ type: "note.create", householdId: "h1", seniorId: "s1", label: "n", payload: {} });
    clearOfflineData();
    expect(getQueue()).toEqual([]);
  });
});

describe("Voice companion", () => {
  it("never records a dose until the user confirms", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/voice")) return json({ intent: "took_med", lang: "en", reply: "Did you just take Metformin due at 08:00?",
        action: { type: "record_dose", medicationId: "m1", scheduledFor: "2026-11-16T02:30:00+00:00", status: "taken", label: "Metformin" } });
      if (url.endsWith("/me")) return json({ user: { uid: "u", locale: "en", timezone: "Asia/Kolkata", accessibility: { voiceRate: 1 } }, memberships: [] });
      return json({ id: "d", status: "taken" });
    });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><VoiceCompanion hid="h1" sid="s1" autoSpeak={false} /></MemoryRouter></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText(/type your question/i), "I took my medicine");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/did you just take metformin/i)).toBeInTheDocument();
    expect(calls.some((u) => u.endsWith("/doses"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: /yes, i took it/i }));
    await waitFor(() => expect(calls.some((u) => u.endsWith("/households/h1/seniors/s1/doses"))).toBe(true));
  });
});
