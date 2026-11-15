import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { LoginPage, SignupPage } from "@/pages/auth/AuthPages";
import { ApiError } from "@/lib/api";
import type { AuthAdapter } from "@/lib/auth-adapters";

function fakeAdapter(overrides: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    kind: "local",
    restore: async () => false,
    login: vi.fn(async () => {}),
    signup: vi.fn(async () => {}),
    logout: async () => {},
    getToken: async () => null,
    refresh: async () => null,
    ...overrides,
  };
}

function renderAt(path: string, adapter: AuthAdapter) {
  const factory = async () => adapter;
  return render(
    <ThemeProvider>
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider adapterFactory={factory}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/app/*" element={<p>APP HOME</p>} />
            <Route path="/invite/:t" element={<p>INVITE PAGE</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("LoginPage", () => {
  it("validates fields before calling the API", async () => {
    const adapter = fakeAdapter();
    renderAt("/login", adapter);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(adapter.login).not.toHaveBeenCalled();
  });

  it("shows the server error and stays on the page when login fails", async () => {
    const adapter = fakeAdapter({ login: vi.fn(async () => { throw new ApiError(401, "invalid_credentials", "Incorrect email or password."); }) });
    renderAt("/login", adapter);
    await userEvent.type(await screen.findByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(screen.queryByText("APP HOME")).not.toBeInTheDocument();
  });

  it("redirects to a safe next path after login", async () => {
    const adapter = fakeAdapter();
    renderAt("/login?next=%2Finvite%2Fabc", adapter);
    await userEvent.type(await screen.findByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse42");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("INVITE PAGE")).toBeInTheDocument());
    expect(adapter.login).toHaveBeenCalledWith("a@example.com", "CorrectHorse42");
  });
});

describe("SignupPage", () => {
  it("enforces password rules and matching confirmation", async () => {
    const adapter = fakeAdapter();
    renderAt("/signup", adapter);
    await userEvent.type(await screen.findByLabelText("Your name"), "Asha");
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.type(screen.getByLabelText("Confirm password"), "different");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 10 characters")).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(adapter.signup).not.toHaveBeenCalled();
  });
});
