import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { configureApi } from "@/lib/api";
import { clearOfflineData } from "@/lib/offline";
import { createAdapter, type AuthAdapter, type SignupInput } from "@/lib/auth-adapters";

type Status = "loading" | "authenticated" | "anonymous" | "error";

interface AuthContextValue {
  status: Status;
  provider: "local" | "firebase" | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, adapterFactory = createAdapter }: {
  children: ReactNode;
  adapterFactory?: () => Promise<AuthAdapter>;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const adapterRef = useRef<AuthAdapter | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adapter = await adapterFactory();
        adapterRef.current = adapter;
        configureApi({
          getToken: () => adapter.getToken(),
          refresh: () => adapter.refresh(),
          onUnauthenticated: () => {
            qc.clear();
            setStatus("anonymous");
          },
        });
        const ok = await adapter.restore();
        if (!cancelled) setStatus(ok ? "authenticated" : "anonymous");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Authentication failed to initialise.");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapterFactory, qc]);

  const login = useCallback(async (email: string, password: string) => {
    await adapterRef.current!.login(email, password);
    qc.clear();
    setStatus("authenticated");
  }, [qc]);

  const signup = useCallback(async (input: SignupInput) => {
    await adapterRef.current!.signup(input);
    qc.clear();
    setStatus("authenticated");
  }, [qc]);

  const logout = useCallback(async () => {
    await adapterRef.current?.logout();
    qc.clear();
    clearOfflineData();
    try {
      localStorage.removeItem("carehub.careContext");
    } catch {
      /* storage unavailable */
    }
    setStatus("anonymous");
  }, [qc]);

  const value = useMemo(
    () => ({ status, error, provider: adapterRef.current?.kind ?? null, login, signup, logout }),
    [status, error, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
