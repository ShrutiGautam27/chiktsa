/** Wellbeing hooks: wishes, wellness, emergency snapshot, voice, reports, calendar, organisations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useInvalidateCare } from "./care-queries";

const S = (hid: string, sid: string) => `/households/${hid}/seniors/${sid}`;

export interface Preferences { preferredLanguage: string; communicationStyle: string; dailyRoutine: string; foodPreferences: string; faithAndCulture: string; likes: string; dislikes: string; careWishes: string; trustedContactsNote: string; updatedByName: string | null; updatedAt: string | null; canEdit: boolean }
export interface WellnessEntry { date: string; mood: number; sleep: number | null; energy: number | null; pain: string | null; note: string; wantsCall: boolean; reportedBy: "self" | "caregiver"; recordedByName: string }
export interface WellnessHistory { entries: WellnessEntry[]; averages: { mood: number | null; sleep: number | null; energy: number | null }; days: number; note: string }
export interface EmergencyCard { fullName: string; preferredName?: string; dateOfBirth?: string | null; primaryLanguage?: string; bloodGroup: string; allergies: string; conditions: string; mobilityNeeds: string; communicationNeeds: string; preferredHospital: string; doctorName: string; doctorPhone: string; additionalNotes: string; contacts: { name: string; relationship: string; phone: string }[]; medications: { name: string; strength: string; dose: string; times: string[] }[] }
export interface EmergencyView { status: "draft" | "approved"; fields: Record<string, string>; include: Record<string, boolean>; approvedByName: string | null; approvedAt: string | null; approvedAs: string | null; card: EmergencyCard; canEdit: boolean; canApprove: boolean; shares: { id: string; expiresAt: string; views: number; lastViewedAt: string | null; createdByName: string }[] }
export interface VoiceAction { type: "record_dose" | "call" | "emergency" | "navigate"; medicationId?: string; scheduledFor?: string; status?: string; label?: string | null; phone?: string | null; to?: string }
export interface VoiceReply { intent: string; reply: string; lang: "en" | "hi"; action: VoiceAction | null }
export interface Report {
  windowDays: number; generatedAt: string; note: string;
  seniors: { seniorId: string; name: string; adherence: { taken: number; skipped: number; unconfirmed: number; recordedRate: number | null; weekly: { week: string; taken: number; skipped: number; unconfirmed: number }[] } | null; wellness: { checkins: number; averageMood: number | null } | null }[];
  tasks: { created: number; completed: number; onTimeRate: number | null; medianHoursToComplete: number | null; weekly: { week: string; created: number; completed: number }[] };
  reminders: { sent: number; escalated: number; acknowledged: number; resolved: number; medianMinutesToRecord: number | null };
  appointments: Record<string, number>;
}
export interface Org { id: string; name: string; myRole: "org_admin" | "org_caregiver"; connectCode?: string; staff: { uid: string; displayName: string; email: string; role: string }[]; households: { householdId: string; householdName: string; linkedAt: string }[] }
export interface OrgDashboard {
  households: { householdId: string; householdName: string; profiles: number; openTasks: number; unassignedTasks: number; gaps: { high: number; medium: number; low: number } }[];
  staff: { uid: string; displayName: string; households: number; currentLoad: number; completed30d: number }[];
  totals: { households: number; profiles: number; highGaps: number; openTasks: number };
}

export const usePreferences = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "seniors", sid ?? "", "prefs"], queryFn: () => api.get<Preferences>(`${S(hid!, sid!)}/preferences`), enabled: !!hid && !!sid, retry: false });
export const useSavePreferences = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (b: Partial<Preferences>) => api.put<Preferences>(`${S(hid, sid)}/preferences`, b), onSuccess: () => inv(hid) });
};
export const useWellness = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "seniors", sid ?? "", "wellness"], queryFn: () => api.get<WellnessHistory>(`${S(hid!, sid!)}/wellness`), enabled: !!hid && !!sid, retry: false });
export const useCheckIn = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (b: { mood: number; sleep?: number; energy?: number; wantsCall?: boolean; note?: string }) => api.post<WellnessEntry>(`${S(hid, sid)}/wellness`, b), onSuccess: () => inv(hid) });
};
export const useEmergency = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "seniors", sid ?? "", "emergency"], queryFn: () => api.get<EmergencyView>(`${S(hid!, sid!)}/emergency`), enabled: !!hid && !!sid });
export const useEmergencyAction = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { action: "save"; fields: Record<string, string>; include: Record<string, boolean> } | { action: "approve" } | { action: "share"; hours: number } | { action: "unshare"; id: string }): Promise<unknown> =>
      v.action === "save" ? api.put<EmergencyView>(`${S(hid, sid)}/emergency`, { fields: v.fields, include: v.include })
        : v.action === "approve" ? api.post<EmergencyView>(`${S(hid, sid)}/emergency/approve`)
          : v.action === "share" ? api.post<{ token: string; expiresAt: string }>(`${S(hid, sid)}/emergency/shares`, { hours: v.hours })
            : api.del(`${S(hid, sid)}/emergency/shares/${v.id}`),
    onSuccess: () => inv(hid),
  });
};
export const useVoice = (hid: string, sid: string) =>
  useMutation({ mutationFn: (b: { text: string; lang: "en" | "hi" }) => api.post<VoiceReply>(`${S(hid, sid)}/voice`, b) });
export const useReport = (hid?: string, days = 30) =>
  useQuery({ queryKey: ["households", hid ?? "", "report", days], queryFn: () => api.get<Report>(`/households/${hid}/reports?days=${days}`), enabled: !!hid, retry: false });
export async function downloadBlob(path: string, filename: string) {
  const b = await api.blob(path);
  const url = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const useOrgs = () => useQuery({ queryKey: ["me", "orgs"], queryFn: () => api.get<Org[]>("/organisations") });
export const useOrgDashboard = (oid?: string, enabled = true) =>
  useQuery({ queryKey: ["me", "orgs", oid ?? "", "dash"], queryFn: () => api.get<OrgDashboard>(`/organisations/${oid}/dashboard`), enabled: !!oid && enabled, retry: false });
export function useOrgAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "create"; name: string } | { action: "staff"; oid: string; email: string; role: string } | { action: "code"; oid: string }
      | { action: "assign"; oid: string; householdId: string; uid: string; role: string; seniorScope: "all" | string[] }) =>
      v.action === "create" ? api.post<Org>("/organisations", { name: v.name })
        : v.action === "staff" ? api.post<Org>(`/organisations/${v.oid}/staff`, { email: v.email, role: v.role })
          : v.action === "code" ? api.post<{ connectCode: string }>(`/organisations/${v.oid}/code`)
            : api.post(`/organisations/${v.oid}/assignments`, { householdId: v.householdId, uid: v.uid, role: v.role, seniorScope: v.seniorScope }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useHouseholdOrg(hid: string) {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { action: "connect"; code: string } | { action: "disconnect"; oid: string }) =>
      v.action === "connect" ? api.post<{ organisationId: string; name: string }>(`/households/${hid}/organisations`, { code: v.code }) : api.del(`/households/${hid}/organisations/${v.oid}`),
    onSuccess: () => inv(hid),
  });
}
