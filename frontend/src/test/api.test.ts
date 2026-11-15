import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, configureApi } from "@/lib/api";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("sends the bearer token", async () => {
    configureApi({ getToken: async () => "tok", refresh: async () => null, onUnauthenticated: () => {} });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { ok: true }));
    await api.get("/me");
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refreshes once on token_expired and retries", async () => {
    let token = "old";
    configureApi({ getToken: async () => token, refresh: async () => (token = "new"), onUnauthenticated: () => {} });
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(401, { error: { code: "token_expired", message: "Session expired." } }))
      .mockResolvedValueOnce(json(200, { user: 1 }));
    await expect(api.get("/me")).resolves.toEqual({ user: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect((spy.mock.calls[1]![1]!.headers as Record<string, string>).Authorization).toBe("Bearer new");
  });

  it("throws ApiError with server message — never a silent success", async () => {
    const onUnauth = vi.fn();
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: onUnauth });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(403, { error: { code: "forbidden", message: "Your role does not allow this action." } }));
    const err = (await api.post("/households/x/seniors", {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Your role does not allow this action.");
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it("signals unauthenticated on a hard 401", async () => {
    const onUnauth = vi.fn();
    configureApi({ getToken: async () => "t", refresh: async () => null, onUnauthenticated: onUnauth });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: { code: "unauthorized", message: "no" } }));
    await expect(api.get("/me")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it("maps network failures to a friendly error", async () => {
    configureApi({ getToken: async () => null, refresh: async () => null, onUnauthenticated: () => {} });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const err = (await api.get("/me").catch((e) => e)) as ApiError;
    expect(err.code).toBe("network_error");
  });
});
