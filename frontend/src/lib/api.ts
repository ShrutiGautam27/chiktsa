/**
 * Typed API client. Attaches the bearer token from the active auth adapter and transparently
 * refreshes once on `token_expired`. Errors are thrown as ApiError — never swallowed, so the UI
 * can never show a fake success for a failed call.
 */
/** Error envelope returned by the API: `{ error: { code, message, fields? } }`. */
interface ApiErrorBody { code?: string; message?: string; fields?: { field: string; message: string }[] }

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

type TokenSource = {
  getToken: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  onUnauthenticated: () => void;
};

let tokenSource: TokenSource | null = null;
export function configureApi(src: TokenSource) {
  tokenSource = src;
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

async function parse(res: Response) {
  if (res.status === 204) return null;
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenSource ? await tokenSource.getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach Chiktsa right now. Check your connection and try again.");
  }

  const data = await parse(res);
  if (res.ok) return data as T;

  const err = (data && typeof data === "object" && "error" in data ? (data as { error?: ApiErrorBody }).error : null) ?? {};
  if (res.status === 401 && retry && tokenSource && err.code === "token_expired") {
    const fresh = await tokenSource.refresh();
    if (fresh) return request<T>(method, path, body, false);
  }
  if (res.status === 401 && tokenSource && !path.startsWith("/auth/")) tokenSource.onUnauthenticated();
  throw new ApiError(res.status, err.code ?? "error", err.message ?? `Request failed (${res.status})`, err.fields);
}

/** Authenticated binary download (documents are never exposed via public URLs). */
async function blob(path: string): Promise<Blob> {
  const token = tokenSource ? await tokenSource.getToken() : null;
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "same-origin" });
  if (!res.ok) {
    const data = await parse(res);
    const err = (data && typeof data === "object" && "error" in data ? (data as { error?: ApiErrorBody }).error : null) ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? `Download failed (${res.status})`);
  }
  return res.blob();
}

/** Authenticated multipart upload. */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = tokenSource ? await tokenSource.getToken() : null;
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach Chiktsa right now. Check your connection and try again.");
  }
  const data = await parse(res);
  if (res.ok) return data as T;
  const err = (data && typeof data === "object" && "error" in data ? (data as { error?: ApiErrorBody }).error : null) ?? {};
  throw new ApiError(res.status, err.code ?? "error", err.message ?? `Upload failed (${res.status})`, err.fields);
}

export const api = {
  blob,
  upload,
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>("PATCH", p, b),
  put: <T>(p: string, b: unknown) => request<T>("PUT", p, b),
  del: <T = null>(p: string) => request<T>("DELETE", p),
};

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.fields?.length) return `${e.message} ${e.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}`;
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
