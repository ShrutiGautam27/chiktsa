import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxItem } from "@/pages/app/NotificationsPage";
import { configureApi } from "@/lib/api";
import type { AppNotification } from "@/lib/care-types";

const wrap = (n: AppNotification) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ul><InboxItem n={n} /></ul></MemoryRouter></QueryClientProvider>);

const reminder: AppNotification = {
  id: "n1", kind: "dose_reminder", title: "Dose due for Grandfather", body: "A scheduled dose is due.", link: "/app/medications",
  read: false, createdAt: new Date().toISOString(), householdId: "h1", ackRequired: true, acknowledgedAt: null,
  meta: { seniorId: "s1", medicationId: "m1", scheduledFor: "2026-11-16T04:15:00+00:00" },
  deliveries: [{ channel: "in_app", status: "delivered", at: "" }, { channel: "email", status: "skipped_not_configured", at: "" }],
};

afterEach(() => vi.restoreAllMocks());

describe("Reminder inbox", () => {
  it("records a dose straight from the reminder", async () => {
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: () => {} });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    wrap(reminder);
    await userEvent.click(screen.getByRole("button", { name: /taken/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("/households/h1/seniors/s1/doses");
    expect(JSON.parse(String(init!.body))).toEqual({ medicationId: "m1", scheduledFor: "2026-11-16T04:15:00+00:00", status: "taken" });
  });

  it("offers acknowledgement and reports undelivered channels honestly", () => {
    wrap(reminder);
    expect(screen.getByRole("button", { name: /i'm on it/i })).toBeInTheDocument();
    expect(screen.getByText(/email · not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/in-app · delivered/i)).toBeInTheDocument();
  });

  it("hides acknowledgement once acknowledged", () => {
    wrap({ ...reminder, acknowledgedAt: new Date().toISOString(), kind: "task_accept", meta: {} });
    expect(screen.queryByRole("button", { name: /i'm on it/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /taken/i })).not.toBeInTheDocument();
  });
});
