/**
 * Universal Care Switcher state: which household and which elderly profile the user is focused on.
 * Only opaque IDs are persisted (localStorage) — never names or medical data. The active membership
 * (role, permissions, scope) is always derived from the server's /me response.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMe } from "./queries";
import type { MembershipSummary, Role } from "@/lib/types";

const KEY = "carehub.careContext";

interface Stored {
  householdId: string | null;
  seniorId: string | null;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable or corrupt */
  }
  return { householdId: null, seniorId: null };
}

interface CareContextValue {
  householdId: string | null;
  seniorId: string | null;
  membership: MembershipSummary | null;
  memberships: MembershipSummary[];
  role: Role | null;
  can: (permission: string) => boolean;
  setHousehold: (hid: string | null) => void;
  setSenior: (sid: string | null) => void;
  isLoading: boolean;
}

const Ctx = createContext<CareContextValue | null>(null);

export function CareContextProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [state, setState] = useState<Stored>(load);
  const memberships = useMemo(() => me.data?.memberships ?? [], [me.data]);

  // Keep the selection valid: fall back to the first household if the stored one is gone/revoked.
  useEffect(() => {
    if (!me.data) return;
    const valid = memberships.some((m) => m.householdId === state.householdId);
    if (!valid) setState({ householdId: memberships[0]?.householdId ?? null, seniorId: null });
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const membership = memberships.find((m) => m.householdId === state.householdId) ?? null;

  const value = useMemo<CareContextValue>(
    () => ({
      householdId: membership ? state.householdId : null,
      seniorId: membership ? state.seniorId : null,
      membership,
      memberships,
      role: membership?.role ?? null,
      can: (p) => !!membership?.permissions.includes(p),
      setHousehold: (hid) => setState({ householdId: hid, seniorId: null }),
      setSenior: (sid) => setState((s) => ({ ...s, seniorId: sid })),
      isLoading: me.isLoading,
    }),
    [membership, memberships, state, me.isLoading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCareContext() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCareContext must be used within CareContextProvider");
  return c;
}
