import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EngineBadge, TaskConverterDialog } from "@/features/ai/components";
import { configureApi } from "@/lib/api";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("AI transparency", () => {
  it("labels which engine produced a result", () => {
    wrap(<><EngineBadge engine="offline" /><EngineBadge engine="gemini" /></>);
    expect(screen.getByText(/offline rules/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini/i)).toBeInTheDocument();
  });
});

describe("Dialect-to-Care Task Converter", () => {
  it("proposes tasks and saves only the ones the user confirms", async () => {
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: () => {} });
    const calls: { url: string; body: any }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/tasks/convert")) return json({ engine: "offline", note: "Proposals only.", proposals: [
        { title: "Take Dadi to the eye doctor", seniorId: "s1", seniorName: "Kamla", assigneeUid: null, assigneeName: null, dueAt: null, kind: "appointment_escort", needsClarification: true, clarification: "No time given." },
        { title: "Buy groceries", seniorId: null, seniorName: null, assigneeUid: null, assigneeName: null, dueAt: null, kind: "errand", needsClarification: false, clarification: "" },
      ] });
      if (url.endsWith("/members")) return json([]);
      return json({ id: "t1" }, 201);
    });
    wrap(<TaskConverterDialog hid="h1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Describe the tasks"), "Dadi eye doctor and groceries");
    await userEvent.click(screen.getByRole("button", { name: /suggest tasks/i }));
    expect(await screen.findByText("No time given.")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith("/h1/tasks"))).toHaveLength(0);           // nothing saved yet
    const boxes = screen.getAllByRole("checkbox", { name: /create this task/i });
    await userEvent.click(boxes[1]!);                                                   // untick groceries
    await userEvent.click(screen.getByRole("button", { name: /create selected tasks/i }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/h1/tasks"))).toHaveLength(1));
    expect(calls.find((c) => c.url.endsWith("/h1/tasks"))!.body).toMatchObject({ title: "Take Dadi to the eye doctor", seniorId: "s1", kind: "appointment_escort" });
  });
});
