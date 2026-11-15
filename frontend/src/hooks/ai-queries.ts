/** AI workflows, care notes, document vault. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useInvalidateCare } from "./care-queries";

const S = (hid: string, sid: string) => `/households/${hid}/seniors/${sid}`;

export type Engine = "gemini" | "offline";
export interface AIStatus { mode: "offline" | "gemini"; geminiConfigured: boolean; effectiveEngine: Engine; model: string | null }
export interface Citation { id: string; type: string; title: string; date: string; link: string; snippet: string }
export interface MemoryResult { answer: string; citations: Citation[]; insufficient: boolean; clinicalEscalation: boolean; engine: Engine; note: string; recordsSearched: number }
export interface Briefing { headline: string; summary: string; priorities: { text: string; factId: string; link: string }[]; engine: Engine; date: string; generatedAt: string; factsUsed: number; note: string }
export interface VisitPrep {
  appointment: { id: string; title: string; providerName: string; location: string; startsAt: string; seniorName: string };
  summary: string;
  sections: {
    medications: { name: string; strength: string; dose: string; times: string[]; instructions: string; verifiedBy: string | null }[];
    unverified: { name: string; issues: string[] }[];
    adherence: { name: string; taken: number; skipped: number; unconfirmed: number }[];
    observations: { date: string; text: string; by: string }[];
    previousVisits: { title: string; date: string; notes: string }[];
    documents: { title: string; kind: string; date: string }[];
  };
  familyQuestions: string[];
  suggestedQuestions: string[];
  bring: string[];
  engine: Engine;
  note: string;
}
export interface CareNote { id: string; seniorId: string; text: string; tags: string[]; authorName: string; createdAt: string }
export interface RxItem { name: string; strength: string; form: string; doseQuantity: number | null; doseUnit: string; frequencyText: string; durationText: string; instructions: string; sourceText: string; uncertainFields: string[] }
export interface Extraction { status: "extracted" | "needs_transcription"; engine: Engine; prescriber?: string; medications: RxItem[]; message: string; legibilityNotes?: string }
export interface VaultDoc { id: string; seniorId: string; kind: string; title: string; filename: string; contentType: string; size: number; uploadedByName: string; createdAt: string; documentDate: string | null; extraction: Extraction | null; extractedText: string }
export interface TaskProposal { title: string; seniorId: string | null; seniorName: string | null; assigneeUid: string | null; assigneeName: string | null; dueAt: string | null; kind: string; needsClarification: boolean; clarification: string }

export const useAIStatus = (hid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "ai"], queryFn: () => api.get<AIStatus>(`/households/${hid}/ai`), enabled: !!hid });
export const useSetAIMode = (hid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (mode: "offline" | "gemini") => api.put<AIStatus>(`/households/${hid}/ai`, { mode }), onSuccess: () => inv(hid) });
};
export const useAskMemory = (hid: string, sid: string) =>
  useMutation({ mutationFn: (question: string) => api.post<MemoryResult>(`${S(hid, sid)}/memory/query`, { question }) });
export const useBriefing = (hid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "briefing"], queryFn: () => api.get<Briefing>(`/households/${hid}/briefing`), enabled: !!hid, staleTime: 10 * 60_000, retry: false });
export const useRefreshBriefing = (hid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: () => api.get<Briefing>(`/households/${hid}/briefing?refresh=true`), onSuccess: () => inv(hid) });
};
export const useVisitPrep = (hid: string, sid: string, aid: string, enabled: boolean) =>
  useQuery({ queryKey: ["households", hid, "seniors", sid, "prep", aid], queryFn: () => api.get<VisitPrep>(`${S(hid, sid)}/appointments/${aid}/prep`), enabled, retry: false });
export const useNotes = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "seniors", sid ?? "", "notes"], queryFn: () => api.get<CareNote[]>(`${S(hid!, sid!)}/notes`), enabled: !!hid && !!sid, retry: false });
export const useAddNote = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (b: { text: string; tags: string[] }) => api.post<CareNote>(`${S(hid, sid)}/notes`, b), onSuccess: () => inv(hid) });
};
export const useDocs = (hid?: string, sid?: string) =>
  useQuery({ queryKey: ["households", hid ?? "", "seniors", sid ?? "", "docs"], queryFn: () => api.get<VaultDoc[]>(`${S(hid!, sid!)}/documents`), enabled: !!hid && !!sid, retry: false });
export const useUploadDoc = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (f: FormData) => api.upload<VaultDoc>(`${S(hid, sid)}/documents`, f), onSuccess: () => inv(hid) });
};
export const useArchiveDoc = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (did: string) => api.del(`${S(hid, sid)}/documents/${did}`), onSuccess: () => inv(hid) });
};
export const useExtract = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (v: { did: string; transcription?: string }) => api.post<Extraction>(`${S(hid, sid)}/documents/${v.did}/extract`, { transcription: v.transcription ?? null }), onSuccess: () => inv(hid) });
};
export const useCreateDrafts = (hid: string, sid: string) => {
  const inv = useInvalidateCare();
  return useMutation({ mutationFn: (v: { did: string; indexes: number[]; responsibleUid?: string | null }) => api.post(`${S(hid, sid)}/documents/${v.did}/drafts`, { indexes: v.indexes, responsibleUid: v.responsibleUid ?? null }), onSuccess: () => inv(hid) });
};
export const useConvertTasks = (hid: string) =>
  useMutation({ mutationFn: (text: string) => api.post<{ proposals: TaskProposal[]; engine: Engine; note: string }>(`/households/${hid}/tasks/convert`, { text }) });
export async function openDocument(hid: string, sid: string, did: string) {
  const b = await api.blob(`${S(hid, sid)}/documents/${did}/file`);
  const url = URL.createObjectURL(b);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
