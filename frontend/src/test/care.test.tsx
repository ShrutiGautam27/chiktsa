import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { VerifyDialog } from "@/features/care/MedicationDialogs";
import { DualTime } from "@/features/care/shared";
import { configureApi } from "@/lib/api";
import { navFor } from "@/lib/navigation";
import type { Medication } from "@/lib/care-types";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const baseMed: Medication = {
  id: "m1", seniorId: "s1", householdId: "h1", name: "Metformin", strength: "500 mg", form: "tablet", doseQuantity: 1, doseUnit: "tablet",
  route: "oral", frequencyText: "BD", times: ["08:00", "20:00"], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startDate: "2026-11-01", endDate: null,
  instructions: "After food", prescriber: "", source: "manual", prescriptionText: "", uncertainFields: [], stockQuantity: null, lowStockDays: 7,
  responsibleUid: "u1", pharmacy: "", status: "pending_verification", verification: null, issues: [], blockingCount: 0, refill: { tracked: false }, createdAt: "",
};

afterEach(() => vi.restoreAllMocks());

describe("Prescription Confusion Firewall — VerifyDialog", () => {
  it("cannot verify while a blocking issue exists", () => {
    const med = { ...baseMed, blockingCount: 1, issues: [{ code: "unclear_field", field: "doseQuantity", severity: "blocking" as const, message: "The dose amount was marked unclear." }] };
    wrap(<VerifyDialog hid="h1" sid="s1" med={med} onClose={() => {}} />);
    expect(screen.getByText("The dose amount was marked unclear.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify and activate/i })).toBeDisabled();
  });

  it("requires acknowledging warnings, then sends the acknowledgement", async () => {
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: () => {} });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...baseMed, status: "active" }), { status: 200 }));
    const med = { ...baseMed, issues: [{ code: "possible_duplicate", field: "name", severity: "warning" as const, message: "Possible duplicate." }] };
    const onClose = vi.fn();
    wrap(<VerifyDialog hid="h1" sid="s1" med={med} onClose={onClose} />);
    const btn = screen.getByRole("button", { name: /verify and activate/i });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/households/h1/seniors/s1/medications/m1/verify");
    expect(JSON.parse(String(init!.body))).toMatchObject({ acknowledgeWarnings: true });
  });
});

describe("Family Time-Zone Coordinator — DualTime", () => {
  it("shows the senior's local time when it differs from the viewer's", async () => {
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: () => {} });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      user: { uid: "u", email: "a@example.com", displayName: "A", timezone: "Europe/London", locale: "en", platformRole: "user", accessibility: {} },
      memberships: [],
    }), { status: 200 }));
    wrap(<DualTime iso="2026-11-16T04:30:00Z" seniorTz="Asia/Kolkata" timeOnly />);
    expect(await screen.findByText(/their time/)).toBeInTheDocument();
  });
});

describe("care navigation", () => {
  it("implemented engines are no longer marked planned; coordination is available", () => {
    const items = navFor("household_owner", () => true).flatMap((s) => s.items);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
    for (const l of ["Medications", "Appointments", "Responsibility Centre", "Care Continuity", "Medication Safety", "Consent & permissions", "Notifications"]) {
      expect(byLabel[l]?.phase).toBeUndefined();
    }
    expect(byLabel["Family Coordination"]).toBeDefined();
    expect(byLabel["AI Care Memory"]?.phase).toBeUndefined();
    expect(Object.values(byLabel).filter((i) => i?.phase)).toEqual([]);   // every module is now built
  });
});
