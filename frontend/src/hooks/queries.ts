/** TanStack Query hooks for core household resources. Query keys are tenant-scoped. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AuditLog, Household, Invitation, Me, Member, Senior, User } from "@/lib/types";

export const qk = {
  me: ["me"] as const,
  households: ["households"] as const,
  household: (hid: string) => ["households", hid] as const,
  seniors: (hid: string) => ["households", hid, "seniors"] as const,
  senior: (hid: string, sid: string) => ["households", hid, "seniors", sid] as const,
  members: (hid: string) => ["households", hid, "members"] as const,
  invitations: (hid: string) => ["households", hid, "invitations"] as const,
  audit: (hid: string, sid?: string) => ["households", hid, "audit", sid ?? "all"] as const,
  myInvitations: ["me", "invitations"] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.get<Me>("/me") });
export const useHouseholds = () => useQuery({ queryKey: qk.households, queryFn: () => api.get<Household[]>("/households") });
export const useHousehold = (hid?: string) =>
  useQuery({ queryKey: qk.household(hid ?? ""), queryFn: () => api.get<Household>(`/households/${hid}`), enabled: !!hid });
export const useSeniors = (hid?: string) =>
  useQuery({ queryKey: qk.seniors(hid ?? ""), queryFn: () => api.get<Senior[]>(`/households/${hid}/seniors`), enabled: !!hid });
export const useSenior = (hid?: string, sid?: string) =>
  useQuery({
    queryKey: qk.senior(hid ?? "", sid ?? ""),
    queryFn: () => api.get<Senior>(`/households/${hid}/seniors/${sid}`),
    enabled: !!hid && !!sid,
  });
export const useMembers = (hid?: string) =>
  useQuery({ queryKey: qk.members(hid ?? ""), queryFn: () => api.get<Member[]>(`/households/${hid}/members`), enabled: !!hid });
export const useInvitations = (hid?: string, enabled = true) =>
  useQuery({
    queryKey: qk.invitations(hid ?? ""),
    queryFn: () => api.get<Invitation[]>(`/households/${hid}/invitations`),
    enabled: !!hid && enabled,
  });
export const useAudit = (hid?: string, sid?: string, enabled = true) =>
  useQuery({
    queryKey: qk.audit(hid ?? "", sid),
    queryFn: () => api.get<AuditLog[]>(`/households/${hid}/audit${sid ? `?seniorId=${encodeURIComponent(sid)}` : ""}`),
    enabled: !!hid && enabled,
  });
export const useMyInvitations = () =>
  useQuery({ queryKey: qk.myInvitations, queryFn: () => api.get<Invitation[]>("/me/invitations") });

/** Invalidate everything belonging to one household (and the cross-household summaries). */
function useInvalidateHousehold() {
  const qc = useQueryClient();
  return (hid?: string) => {
    if (hid) qc.invalidateQueries({ queryKey: qk.household(hid) });
    qc.invalidateQueries({ queryKey: qk.households, exact: true });
    qc.invalidateQueries({ queryKey: qk.me });
  };
}

export function useCreateHousehold() {
  const inv = useInvalidateHousehold();
  return useMutation({
    mutationFn: (b: { name: string; timezone: string }) => api.post<Household>("/households", b),
    onSuccess: (h) => inv(h.id),
  });
}

export function useUpdateHousehold(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({
    mutationFn: (b: Partial<Pick<Household, "name" | "timezone">>) => api.patch<Household>(`/households/${hid}`, b),
    onSuccess: () => inv(hid),
  });
}

export type SeniorInput = Omit<Senior, "id" | "householdId" | "status" | "age" | "createdAt" | "updatedAt">;

export function useSaveSenior(hid: string, sid?: string) {
  const inv = useInvalidateHousehold();
  return useMutation({
    mutationFn: (b: Partial<SeniorInput>) =>
      sid ? api.patch<Senior>(`/households/${hid}/seniors/${sid}`, b) : api.post<Senior>(`/households/${hid}/seniors`, b),
    onSuccess: () => inv(hid),
  });
}

export function useArchiveSenior(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({ mutationFn: (sid: string) => api.del(`/households/${hid}/seniors/${sid}`), onSuccess: () => inv(hid) });
}

export function useCreateInvitation(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({
    mutationFn: (b: { email: string; role: string; seniorScope: "all" | string[]; linkedSeniorId?: string; accessExpiresAt?: string }) =>
      api.post<Invitation>(`/households/${hid}/invitations`, b),
    onSuccess: () => inv(hid),
  });
}

export function useRevokeInvitation(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({ mutationFn: (id: string) => api.del(`/households/${hid}/invitations/${id}`), onSuccess: () => inv(hid) });
}

export function useUpdateMember(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({
    mutationFn: ({ uid, ...b }: { uid: string; role?: string; seniorScope?: "all" | string[]; linkedSeniorId?: string | null; expiresAt?: string; clearExpiry?: boolean }) =>
      api.patch<Member>(`/households/${hid}/members/${uid}`, b),
    onSuccess: () => inv(hid),
  });
}

export function useRemoveMember(hid: string) {
  const inv = useInvalidateHousehold();
  return useMutation({ mutationFn: (uid: string) => api.del(`/households/${hid}/members/${uid}`), onSuccess: () => inv(hid) });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { token?: string; id?: string }) =>
      args.token
        ? api.post<{ householdId: string; role: string }>(`/invitations/${encodeURIComponent(args.token)}/accept`)
        : api.post<{ householdId: string; role: string }>(`/me/invitations/${args.id}/accept`),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<Pick<User, "displayName" | "timezone" | "locale">> & { accessibility?: Partial<User["accessibility"]> }) =>
      api.patch<User>("/me", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}
