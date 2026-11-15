import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, FileLock2, FileText, ScanLine, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { openDocument, useArchiveDoc, useCreateDrafts, useDocs, useExtract, useUploadDoc, type VaultDoc } from "@/hooks/ai-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { ApiError, errorMessage } from "@/lib/api";
import type { Senior } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { EngineBadge } from "@/features/ai/components";
import { MemberSelect, NeedsSenior, ProfilePicker } from "@/features/care/shared";

const KINDS: [string, string][] = [["prescription", "Prescription"], ["lab_report", "Lab report"], ["discharge_summary", "Discharge summary"],
  ["visit_summary", "Visit summary"], ["insurance", "Insurance"], ["other", "Other"]];
const LABEL = Object.fromEntries(KINDS);

function UploadCard({ hid, sid }: { hid: string; sid: string }) {
  const up = useUploadDoc(hid, sid);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("prescription");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [drag, setDrag] = useState(false);
  const pick = (f?: File | null) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller.");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };
  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file); fd.append("kind", kind); fd.append("title", title); if (date) fd.append("documentDate", date);
    up.mutate(fd, { onSuccess: () => { toast.success("Uploaded securely"); setFile(null); setTitle(""); setDate(""); }, onError: (e) => toast.error(errorMessage(e)) });
  };
  return (
    <Card>
      <CardHeader><CardTitle>Add a document</CardTitle><CardDescription>PDF, PNG, JPEG or WebP up to 10 MB. Stored privately — opened only through CareHub after a permission check.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          className={cn("flex w-full flex-col items-center rounded-2xl border-2 border-dashed p-6 text-sm transition-colors", drag ? "border-brand-500 bg-brand-50" : "border-sage-200 hover:bg-sage-50")}>
          <Upload className="mb-2 size-6 text-brand-600" />{file ? <span className="font-medium">{file.name} · {(file.size / 1024).toFixed(0)} KB</span> : <span>Drop a file here or <span className="text-brand-700 underline">browse</span></span>}
        </button>
        <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose file" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type"><NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
          <Field label="Document date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end"><Button onClick={submit} loading={up.isPending} disabled={!file}><Upload /> Upload</Button></div>
      </CardContent>
    </Card>
  );
}

function ExtractDialog({ hid, sid, doc, onClose }: { hid: string; sid: string; doc: VaultDoc; onClose: () => void }) {
  const extract = useExtract(hid, sid);
  const drafts = useCreateDrafts(hid, sid);
  const [text, setText] = useState(doc.extractedText || "");
  const [chosen, setChosen] = useState<number[]>([]);
  const [resp, setResp] = useState("");
  const ex = extract.data ?? doc.extraction;
  const run = () => extract.mutate({ did: doc.id, transcription: text || undefined }, {
    onSuccess: (r) => setChosen(r.medications.map((_, i) => i)), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-3xl" title={`Read prescription — ${doc.title}`}
      description="Extraction only proposes medicines. Each one is added as “awaiting verification” and the Confusion Firewall checks it before anything is scheduled.">
      <div className="space-y-4 text-sm">
        <Button variant="outline" size="sm" onClick={() => openDocument(hid, sid, doc.id).catch((e) => toast.error(errorMessage(e)))}><ExternalLink /> View original</Button>
        <Field label="Transcription (optional with cloud AI, required in offline mode)" hint="One medicine per line, exactly as written. Use “?” for anything you can't read — it will be flagged.">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Tab Metformin 500 mg 1-0-1 after food x 30 days\nTab Amlo? 5 mg OD"} />
        </Field>
        <div className="flex justify-end"><Button onClick={run} loading={extract.isPending}><ScanLine /> Extract</Button></div>
        {ex && ex.status === "needs_transcription" && <p className="rounded-xl bg-warning-50 p-3 text-warning-600">{ex.message}</p>}
        {ex && ex.status === "extracted" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><EngineBadge engine={ex.engine} /> {ex.message}{ex.prescriber && ` · ${ex.prescriber}`}</div>
            {ex.medications.length === 0 && <p className="text-ink-500">No medicines were recognised. Check the transcription format.</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead className="text-xs uppercase text-ink-500"><tr><th className="p-2" /><th className="p-2">Medicine</th><th className="p-2">Strength</th><th className="p-2">Dose</th><th className="p-2">Frequency</th><th className="p-2">Instructions</th></tr></thead>
                <tbody>{ex.medications.map((m, i) => {
                  const u = (f: string) => m.uncertainFields.includes(f);
                  const cell = (f: string, v: string) => <td className={cn("p-2", u(f) && "bg-warning-50 text-warning-600")}>{v || <em className="text-ink-300">—</em>}{u(f) && <AlertTriangle className="ml-1 inline size-3.5" aria-label="Unclear" />}</td>;
                  return (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="p-2"><input type="checkbox" aria-label={`Add ${m.name || "medicine " + (i + 1)}`} className="size-4 accent-brand-600" checked={chosen.includes(i)} onChange={() => setChosen(chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i])} /></td>
                      {cell("name", m.name)}{cell("strength", m.strength)}{cell("doseQuantity", m.doseQuantity != null ? `${m.doseQuantity} ${m.doseUnit}` : "")}{cell("frequencyText", m.frequencyText)}{cell("instructions", [m.instructions, m.durationText].filter(Boolean).join(", "))}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {ex.medications.length > 0 && <>
              <p className="rounded-xl bg-sage-50 p-3 text-xs text-ink-700">Dose times are never guessed from abbreviations like “BD” or “1-0-1”. You'll set them, and an authorised person verifies everything before the schedule starts.</p>
              <Field label="Who will confirm doses?"><MemberSelect hid={hid} seniorId={sid} value={resp} onChange={setResp} placeholder="Decide later" excludeSeniors={false} /></Field>
              <div className="flex justify-end"><Button disabled={!chosen.length} loading={drafts.isPending} onClick={() => drafts.mutate({ did: doc.id, indexes: chosen, responsibleUid: resp || null }, {
                onSuccess: () => { toast.success(`${chosen.length} medicine(s) added — awaiting verification`); onClose(); }, onError: (e) => toast.error(errorMessage(e)) })}>
                Add {chosen.length} for verification</Button></div>
            </>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Vault({ hid, senior }: { hid: string; senior: Senior }) {
  const docs = useDocs(hid, senior.id);
  const archive = useArchiveDoc(hid, senior.id);
  const { can } = useCareContext();
  const [extracting, setExtracting] = useState<VaultDoc | null>(null);
  const [removing, setRemoving] = useState<VaultDoc | null>(null);
  if (docs.isError && docs.error instanceof ApiError && docs.error.status === 403)
    return <EmptyState icon={FileLock2} title="Documents not shared" description={`${senior.fullName} hasn't shared documents with you.`} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      {can("care.log.write") ? <UploadCard hid={hid} sid={senior.id} /> : <div />}
      <Card>
        <CardHeader><CardTitle>{senior.preferredName || senior.fullName}'s documents</CardTitle></CardHeader>
        <CardContent>
          {docs.isLoading ? <Skeleton className="h-40" /> : docs.isError ? <ErrorState error={docs.error} /> : !docs.data?.length ? (
            <p className="text-sm text-ink-500">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-line">{docs.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="size-5 text-brand-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-ink-500">{LABEL[d.kind]} · {d.documentDate ?? relativeTime(d.createdAt)} · {d.uploadedByName} · {(d.size / 1024).toFixed(0)} KB</p>
                  {d.extraction?.status === "extracted" && <Badge tone="brand" className="mt-1">{d.extraction.medications.length} medicine(s) read</Badge>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => openDocument(hid, senior.id, d.id).catch((e) => toast.error(errorMessage(e)))}><ExternalLink /> Open</Button>
                {d.kind === "prescription" && can("senior.medical.write") && <Button size="sm" variant="secondary" onClick={() => setExtracting(d)}><ScanLine /> Read</Button>}
                {can("senior.medical.write") && <Button size="icon" variant="ghost" aria-label={`Remove ${d.title}`} onClick={() => setRemoving(d)}><Trash2 /></Button>}
              </li>))}</ul>
          )}
        </CardContent>
      </Card>
      {extracting && <ExtractDialog hid={hid} sid={senior.id} doc={extracting} onClose={() => setExtracting(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.title}?`} description="It will be archived and hidden. The access history is kept."
        confirmLabel="Remove" destructive loading={archive.isPending} onConfirm={() => removing && archive.mutate(removing.id, { onSuccess: () => { toast.success("Removed"); setRemoving(null); }, onError: (e) => toast.error(errorMessage(e)) })} />
    </div>
  );
}

export function DocumentsPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Document Vault" description="Prescriptions, reports and visit summaries — private, per-profile, and readable into the medication firewall." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <Vault key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}
