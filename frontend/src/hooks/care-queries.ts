/** TanStack Query hooks for Phase 2 care records and the three intelligence engines. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Absence, Adherence, Appointment, AppNotification, CareTask, ConsentView, Contribution, DeliveryPrefs, DoseEvent, GapReport, Handover,
  HouseholdOverview, JourneyEntry, Medication, NotificationRules, ReminderActivity, Responsibilities,
} from "@/lib/care-types";

const S = (hid: string, sid: string) => `/households/${hid}/seniors/${sid}`;

export const ck = {
  meds: (hid: string, sid: string) => ["households", hid, "seniors", sid, "meds"] as const,
  doses: (hid: string, sid: string, day: string) => ["households", hid, "seniors", sid, "doses", day] as const,
  adherence: (hid: string, sid: string, days: number) => ["households", hid, "seniors", sid, "adherence", days] as const,
  journey: (hid: string, sid: string, mid: string) => ["households", hid, "seniors", sid, "journey", mid] as const,
  review: (hid: string, sid: string) => ["households", hid, "seniors", sid, "review"] as const,
  appts: (hid: string, sid: string) => ["households", hid, "seniors", sid, "appts"] as const,
  hhAppts: (hid: string) => ["households", hid, "appts"] as const,
  tasks: (hid: string) => ["households", hid, "tasks"] as const,
  gaps: (hid: string, sid?: string) => ["households", hid, "gaps", sid ?? "all"] as const,
  handovers: (hid: string) => ["households", hid, "handovers"] as const,
  absences: (hid: string) => ["households", hid, "absences"] as const,
  contribution: (hid: string) => ["households", hid, "contribution"] as const,
  consents: (hid: string, sid: string) => ["households", hid, "seniors", sid, "consents"] as const,
  overview: ["me", "overview"] as const,
  responsibilities: ["me", "responsibilities"] as const,
  notifications: ["me", "notifications"] as const,
};

/** Care data is interconnected (a dose affects stock, gaps, workload…), so writes refresh the household. */
export function useInvalidateCare() {
  const qc = useQueryClient();
  return (hid?: string) => {
    if (hid) qc.invalidateQueries({ queryKey: ["households", hid] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
}

function useCareMutation<TVars, TRes = unknown>(hid: string | undefined, fn: (v: TVars) => Promise<TRes>) {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: fn, onSuccess: () => inv(hid) });
}

// ---- medications
export const useMeds = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ck.meds(hid ?? "", sid ?? ""), queryFn: () => api.get<Medication[]>(`${S(hid!, sid!)}/medications`), enabled: !!hid && !!sid });
export const useDoses = (hid?: string, sid?: string, day?: string) =>
  useQuery({
    queryKey: ck.doses(hid ?? "", sid ?? "", day ?? "today"),
    queryFn: () => api.get<DoseEvent[]>(`${S(hid!, sid!)}/doses${day ? `?start=${day}&end=${day}` : ""}`),
    enabled: !!hid && !!sid,
  });
export const useAdherence = (hid?: string, sid?: string, days = 7) =>
  useQuery({ queryKey: ck.adherence(hid ?? "", sid ?? "", days), queryFn: () => api.get<Adherence>(`${S(hid!, sid!)}/adherence?days=${days}`), enabled: !!hid && !!sid });
export const useJourney = (hid?: string, sid?: string, mid?: string) =>
  useQuery({ queryKey: ck.journey(hid ?? "", sid ?? "", mid ?? ""), queryFn: () => api.get<JourneyEntry[]>(`${S(hid!, sid!)}/medications/${mid}/journey`), enabled: !!hid && !!sid && !!mid });
export const useMedReview = (hid?: string, sid?: string) =>
  useQuery({
    queryKey: ck.review(hid ?? "", sid ?? ""),
    queryFn: () => api.get<{ interactionCheck: string; reason: string; duplicates: { name: string; medicationIds: string[] }[] }>(`${S(hid!, sid!)}/medication-review`),
    enabled: !!hid && !!sid,
  });

export const useSaveMed = (hid: string, sid: string, mid?: string) =>
  useCareMutation(hid, (b: Partial<Medication> & Record<string, unknown>) =>
    mid ? api.patch<Medication>(`${S(hid, sid)}/medications/${mid}`, b) : api.post<Medication>(`${S(hid, sid)}/medications`, b));
export const useVerifyMed = (hid: string, sid: string) =>
  useCareMutation(hid, (v: { mid: string; acknowledgeWarnings: boolean; note?: string }) =>
    api.post<Medication>(`${S(hid, sid)}/medications/${v.mid}/verify`, { acknowledgeWarnings: v.acknowledgeWarnings, note: v.note ?? "" }));
export const useMedStatus = (hid: string, sid: string) =>
  useCareMutation(hid, (v: { mid: string; status: "active" | "paused" | "ended"; reason?: string }) =>
    api.post<Medication>(`${S(hid, sid)}/medications/${v.mid}/status`, { status: v.status, reason: v.reason ?? "" }));
export const useRefill = (hid: string, sid: string) =>
  useCareMutation(hid, (v: { mid: string; quantity: number }) => api.post<Medication>(`${S(hid, sid)}/medications/${v.mid}/refill`, { quantity: v.quantity }));
export const useRecordDose = (hid: string, sid: string) =>
  useCareMutation(hid, (v: { medicationId: string; scheduledFor: string; status: "taken" | "skipped" }) => api.post(`${S(hid, sid)}/doses`, v));

// ---- appointments
export const useAppointments = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ck.appts(hid ?? "", sid ?? ""), queryFn: () => api.get<Appointment[]>(`${S(hid!, sid!)}/appointments`), enabled: !!hid && !!sid });
export const useHouseholdAppointments = (hid?: string, days = 14, enabled = true) =>
  useQuery({ queryKey: [...ck.hhAppts(hid ?? ""), days], queryFn: () => api.get<Appointment[]>(`/households/${hid}/appointments?days=${days}`), enabled: !!hid && enabled });
export const useSaveAppointment = (hid: string, sid: string, aid?: string) =>
  useCareMutation(hid, (b: Record<string, unknown>) =>
    aid ? api.patch<Appointment>(`${S(hid, sid)}/appointments/${aid}`, b) : api.post<Appointment>(`${S(hid, sid)}/appointments`, b));
export const useAppointmentAction = (hid: string) => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { hid?: string; sid: string; aid: string; action: "escort" | "postpone" | "complete" | "cancel"; body?: unknown }) =>
      api.post<Appointment>(`${S(v.hid ?? hid, v.sid)}/appointments/${v.aid}/${v.action}`, v.body ?? {}),
    onSuccess: (_d, v) => inv(v.hid ?? hid),
  });
};

// ---- tasks
export const useTasks = (hid?: string) =>
  useQuery({ queryKey: ck.tasks(hid ?? ""), queryFn: () => api.get<CareTask[]>(`/households/${hid}/tasks`), enabled: !!hid });
export const useCreateTask = (hid: string) => useCareMutation(hid, (b: Record<string, unknown>) => api.post<CareTask>(`/households/${hid}/tasks`, b));
export const useTaskAction = () => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { hid: string; tid: string; action: "accept" | "decline" | "claim" | "complete" | "cancel" | "reassign"; body?: unknown }) =>
      api.post<CareTask>(`/households/${v.hid}/tasks/${v.tid}/${v.action}`, v.body ?? {}),
    onSuccess: (_d, v) => inv(v.hid),
  });
};

// ---- engine 1
export const useGaps = (hid?: string, sid?: string, enabled = true) =>
  useQuery({ queryKey: ck.gaps(hid ?? "", sid), queryFn: () => api.get<GapReport>(`/households/${hid}/gaps${sid ? `?seniorId=${sid}` : ""}`), enabled: !!hid && enabled });
export const useHandovers = (hid?: string) =>
  useQuery({ queryKey: ck.handovers(hid ?? ""), queryFn: () => api.get<Handover[]>(`/households/${hid}/handovers`), enabled: !!hid });
export const useCreateHandover = (hid: string) => useCareMutation(hid, (b: Record<string, unknown>) => api.post<Handover>(`/households/${hid}/handovers`, b));
export const useAckHandover = () => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { hid: string; id: string; note?: string }) => api.post<Handover>(`/households/${v.hid}/handovers/${v.id}/acknowledge`, { note: v.note ?? "" }),
    onSuccess: (_d, v) => inv(v.hid),
  });
};
export const useAbsences = (hid?: string) =>
  useQuery({ queryKey: ck.absences(hid ?? ""), queryFn: () => api.get<Absence[]>(`/households/${hid}/absences`), enabled: !!hid });
export const useReportAbsence = (hid: string) => useCareMutation(hid, (b: { startsAt: string; endsAt: string; reason: string }) => api.post<Absence>(`/households/${hid}/absences`, b));
export const useCover = () => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { hid: string; absenceId: string; itemType: string; itemId: string }) =>
      api.post<Absence>(`/households/${v.hid}/absences/${v.absenceId}/cover`, { itemType: v.itemType, itemId: v.itemId }),
    onSuccess: (_d, v) => inv(v.hid),
  });
};
export const useCancelAbsence = (hid: string) => useCareMutation(hid, (id: string) => api.del(`/households/${hid}/absences/${id}`));
export const useSimulate = (hid: string) => useMutation({ mutationFn: (b: Record<string, unknown>) => api.post<Record<string, any>>(`/households/${hid}/simulate`, b) });

// ---- engine 3
export const useContribution = (hid?: string) =>
  useQuery({ queryKey: ck.contribution(hid ?? ""), queryFn: () => api.get<Contribution>(`/households/${hid}/contribution`), enabled: !!hid });
export const useOverview = () => useQuery({ queryKey: ck.overview, queryFn: () => api.get<HouseholdOverview[]>("/me/overview") });
export const useResponsibilities = () => useQuery({ queryKey: ck.responsibilities, queryFn: () => api.get<Responsibilities>("/me/responsibilities") });
export const useConsents = (hid?: string, sid?: string, enabled = true) =>
  useQuery({ queryKey: ck.consents(hid ?? "", sid ?? ""), queryFn: () => api.get<ConsentView>(`${S(hid!, sid!)}/consents`), enabled: !!hid && !!sid && enabled, retry: false });
export const useConsentAction = (hid: string, sid: string) =>
  useCareMutation(hid, (v: { uid: string; action: "set" | "revoke" | "restore"; categories?: string[]; expiresAt?: string | null }) =>
    v.action === "set"
      ? api.put<ConsentView>(`${S(hid, sid)}/consents/${v.uid}`, { categories: v.categories ?? [], expiresAt: v.expiresAt ?? null })
      : v.action === "revoke"
        ? api.post<ConsentView>(`${S(hid, sid)}/consents/${v.uid}/revoke`)
        : api.del<ConsentView>(`${S(hid, sid)}/consents/${v.uid}`));

// ---- notifications
export const useNotifications = () =>
  useQuery({ queryKey: ck.notifications, queryFn: () => api.get<{ items: AppNotification[]; unread: number }>("/me/notifications"), refetchInterval: 60_000 });
export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => api.post(id ? `/me/notifications/${id}/read` : "/me/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.notifications }),
  });
};

// ---- phase 3: automation
export const useAcknowledge = () => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (v: { id: string; hid?: string | null }) => api.post(`/me/notifications/${v.id}/acknowledge`), onSuccess: (_d, v) => inv(v.hid ?? undefined) });
};
export const useRecordDoseFromNotification = () => {
  const inv = useInvalidateCare();
  return useMutation({
    mutationFn: (v: { hid: string; sid: string; medicationId: string; scheduledFor: string; status: "taken" | "skipped" }) =>
      api.post(`/households/${v.hid}/seniors/${v.sid}/doses`, { medicationId: v.medicationId, scheduledFor: v.scheduledFor, status: v.status }),
    onSuccess: (_d, v) => inv(v.hid),
  });
};
export const useRules = (hid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "rules"], queryFn: () => api.get<NotificationRules>(`/households/${hid}/notification-rules`), enabled: !!hid });
export const useSaveRules = (hid: string) => useCareMutation(hid, (b: Partial<NotificationRules>) => api.put<NotificationRules>(`/households/${hid}/notification-rules`, b));
export const useReminders = (hid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "reminders"], queryFn: () => api.get<ReminderActivity[]>(`/households/${hid}/reminders?days=7`), enabled: !!hid, refetchInterval: 60_000 });
export const useRunReminders = (hid: string) => useCareMutation(hid, () => api.post<Record<string, number>>(`/households/${hid}/reminders/run`));
export const useDeliveryPrefs = () => useQuery({ queryKey: ["me", "delivery-prefs"], queryFn: () => api.get<DeliveryPrefs>("/me/notification-preferences") });
export const useSaveDeliveryPrefs = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { email?: boolean; push?: boolean }) => api.put<DeliveryPrefs>("/me/notification-preferences", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "delivery-prefs"] }) });
};
