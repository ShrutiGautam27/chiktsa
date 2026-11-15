/**
 * Authentication adapters.
 *  - LocalAuthAdapter: development/demo. Email+password against the CareHub API; access token kept
 *    in memory only, refresh token in an HttpOnly cookie the page cannot read.
 *  - FirebaseAuthAdapter: production. Firebase JS SDK; the Firebase ID token is sent to the API.
 *    Activated automatically when VITE_FIREBASE_API_KEY etc. are configured AND the API reports
 *    provider "firebase". (PENDING: requires a Firebase project — see README.)
 */
import type { User } from "./types";
import { ApiError } from "./api";

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  timezone: string;
  locale: "en" | "hi";
}

export interface AuthAdapter {
  readonly kind: "local" | "firebase";
  /** Restore an existing session (returns true if signed in). */
  restore(): Promise<boolean>;
  login(email: string, password: string): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;
  getToken(): Promise<string | null>;
  refresh(): Promise<string | null>;
}

async function postJson(path: string, body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Request failed", err.fields);
  }
  return data as { accessToken: string; expiresIn: number; user: User } | null;
}

export class LocalAuthAdapter implements AuthAdapter {
  readonly kind = "local" as const;
  private token: string | null = null;
  private refreshing: Promise<string | null> | null = null;

  async restore() {
    return (await this.refresh()) !== null;
  }
  async login(email: string, password: string) {
    this.token = (await postJson("/auth/login", { email, password }))!.accessToken;
  }
  async signup(input: SignupInput) {
    this.token = (await postJson("/auth/signup", input))!.accessToken;
  }
  async logout() {
    this.token = null;
    await postJson("/auth/logout").catch(() => undefined);
  }
  async getToken() {
    return this.token;
  }
  /** De-duplicates concurrent refreshes (several queries may hit 401 at once). */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = postJson("/auth/refresh")
        .then((d) => (this.token = d?.accessToken ?? null))
        .catch(() => (this.token = null))
        .finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }
}

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export class FirebaseAuthAdapter implements AuthAdapter {
  readonly kind = "firebase" as const;
  private authP = (async () => {
    const [{ initializeApp }, fbAuth] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = initializeApp(firebaseConfig);
    const auth = fbAuth.getAuth(app);
    // Local development against the Firebase Auth emulator (never set in production builds).
    const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST as string | undefined;
    if (emulator) fbAuth.connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
    return { auth, fbAuth };
  })();

  async restore() {
    const { auth } = await this.authP;
    await auth.authStateReady();
    return auth.currentUser !== null;
  }
  async login(email: string, password: string) {
    const { auth, fbAuth } = await this.authP;
    await fbAuth.signInWithEmailAndPassword(auth, email, password);
  }
  async signup(input: SignupInput) {
    const { auth, fbAuth } = await this.authP;
    const cred = await fbAuth.createUserWithEmailAndPassword(auth, input.email, input.password);
    await fbAuth.updateProfile(cred.user, { displayName: input.displayName });
    await cred.user.getIdToken(true);
  }
  async logout() {
    const { auth, fbAuth } = await this.authP;
    await fbAuth.signOut(auth);
  }
  async getToken() {
    const { auth } = await this.authP;
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  }
  async refresh() {
    const { auth } = await this.authP;
    return auth.currentUser ? auth.currentUser.getIdToken(true) : null;
  }
}

let adapterPromise: Promise<AuthAdapter> | null = null;
let restorePromise: Promise<boolean> | null = null;

/** Process-wide singleton: one adapter, one session restore (StrictMode-safe). */
export function createAdapter(): Promise<AuthAdapter> {
  if (!adapterPromise) {
    adapterPromise = buildAdapter().then((a) => {
      const restore = a.restore.bind(a);
      a.restore = () => (restorePromise ??= restore().finally(() => setTimeout(() => (restorePromise = null), 0)));
      return a;
    });
    adapterPromise.catch(() => (adapterPromise = null));
  }
  return adapterPromise;
}

/** True when the API reports it's the public demo deployment (in-memory data that resets). */
export let demoMode = false;

async function buildAdapter(): Promise<AuthAdapter> {
  let provider = "local";
  try {
    const res = await fetch("/api/auth/config");
    if (res.ok) {
      const cfg = await res.json();
      provider = cfg.provider;
      demoMode = Boolean(cfg.demo);
    }
  } catch {
    /* API unreachable: fall back to local; requests will surface the network error. */
  }
  if (provider === "firebase") {
    if (!firebaseConfigured) throw new Error("The API expects Firebase auth but VITE_FIREBASE_* is not configured.");
    return new FirebaseAuthAdapter();
  }
  return new LocalAuthAdapter();
}
