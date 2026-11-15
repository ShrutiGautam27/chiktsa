import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, AlertTriangle, CheckCircle2, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useJourney, useSaveMed, useVerifyMed } from "@/hooks/care-queries";
import { errorMessage } from "@/lib/api";
import type { Medication } from "@/lib/care-types";
import { cn } from "@/lib/utils";
import { MemberSelect, fmt } from "./shared";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface FormState {
  source: "manual" | "prescription";
  prescriptionText: string;
  name: string;
  strength: string;
  form: string;
  doseQuantity: string;
  doseUnit: string;
  frequencyText: string;
  times: string[];
  daysOfWeek: number[];
  startDate: string;
  endDate: string;
  instructions: string;
  prescriber: string;
  responsibleUid: string;
  stockQuantity: string;
  pharmacy: string;
  uncertainFields: string[];
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): FormState => ({
  source: "manual", prescriptionText: "", name: "", strength: "", form: "tablet", doseQuantity: "1", doseUnit: "tablet",
  frequencyText: "", times: [], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startDate: today(), endDate: "", instructions: "",
  prescriber: "", responsibleUid: "", stockQuantity: "", pharmacy: "", uncertainFields: [],
});

export function MedicationFormDialog({ open, onOpenChange, hid, sid, med }: {
  open: boolean; onOpenChange: (o: boolean) => void; hid: string; sid: string; med?: Medication;
}) {
  const save = useSaveMed(hid, sid, med?.id);
  const [f, setF] = useState<FormState>(blank);
  const [newTime, setNewTime] = useState("08:00");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(med ? {
      source: med.source, prescriptionText: med.prescriptionText ?? "", name: med.name ?? "", strength: med.strength ?? "",
      form: med.form, doseQuantity: med.doseQuantity != null ? String(med.doseQuantity) : "", doseUnit: med.doseUnit,
      frequencyText: med.frequencyText ?? "", times: med.times ?? [], daysOfWeek: med.daysOfWeek, startDate: med.startDate ?? "",
      endDate: med.endDate ?? "", instructions: med.instructions ?? "", prescriber: med.prescriber ?? "",
      responsibleUid: med.responsibleUid ?? "", stockQuantity: med.stockQuantity != null ? String(med.stockQuantity) : "",
      pharmacy: med.pharmacy ?? "", uncertainFields: med.uncertainFields ?? [],
    } : blank());
  }, [open, med]);

  const toggleUnclear = (k: string) => set("uncertainFields", f.uncertainFields.includes(k) ? f.uncertainFields.filter((x) => x !== k) : [...f.uncertainFields, k]);
  const unclear = (k: string) => f.source === "prescription" && f.uncertainFields.includes(k);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim() && !unclear("name")) errs.name = "Enter the medicine name, or mark it unclear on the prescription";
    if (f.doseQuantity && !(Number(f.doseQuantity) > 0)) errs.doseQuantity = "Enter a positive amount";
    if (f.stockQuantity && !(Number(f.stockQuantity) >= 0)) errs.stockQuantity = "Enter a valid quantity";
    if (f.endDate && f.startDate && f.endDate < f.startDate) errs.endDate = "End date is before start date";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = {
      name: f.name.trim(), strength: f.strength.trim(), form: f.form, doseQuantity: f.doseQuantity ? Number(f.doseQuantity) : null,
      doseUnit: f.doseUnit.trim() || "tablet", frequencyText: f.frequencyText.trim(), times: f.times, daysOfWeek: f.daysOfWeek,
      startDate: f.startDate || null, instructions: f.instructions.trim(), prescriber: f.prescriber.trim(),
      prescriptionText: f.prescriptionText, uncertainFields: f.source === "prescription" ? f.uncertainFields : [],
      stockQuantity: f.stockQuantity ? Number(f.stockQuantity) : null, pharmacy: f.pharmacy.trim(),
    };
    if (med) {
      if (!f.endDate) body.clearEndDate = true; else body.endDate = f.endDate;
      if (!f.responsibleUid) body.clearResponsible = true; else body.responsibleUid = f.responsibleUid;
      if (body.doseQuantity === null) delete body.doseQuantity;
      if (body.stockQuantity === null) delete body.stockQuantity;
      if (body.startDate === null) delete body.startDate;
    } else {
      body.source = f.source;
      body.endDate = f.endDate || null;
      body.responsibleUid = f.responsibleUid || null;
    }
    try {
      const saved = await save.mutateAsync(body as Partial<Medication>);
      toast.success(saved.status === "pending_verification" ? "Saved — waiting for verification before it's scheduled" : "Medication saved");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const UnclearToggle = ({ k }: { k: string }) => f.source !== "prescription" ? null : (
    <label className="mt-1 flex items-center gap-1.5 text-xs text-warning-600">
      <input type="checkbox" aria-label={`Mark ${k} unclear on the prescription`} checked={f.uncertainFields.includes(k)} onChange={() => toggleUnclear(k)} className="accent-warning-600" />
      Unclear on prescription
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-3xl" title={med ? `Edit ${med.name || "medication"}` : "Add a medication"}
      description="Enter details exactly as written on the verified prescription. Nothing is scheduled until an authorised person verifies it.">
      <form onSubmit={submit} noValidate className="space-y-6">
        {!med && (
          <div role="radiogroup" aria-label="Source" className="grid gap-2 sm:grid-cols-2">
            {([["manual", "Entered manually", "From a known, current prescription"], ["prescription", "Transcribed prescription", "Copy the text and flag anything hard to read"]] as const).map(([v, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={f.source === v} onClick={() => set("source", v)}
                className={cn("rounded-xl border p-3 text-left text-sm", f.source === v ? "border-brand-500 bg-brand-50" : "border-line hover:bg-sage-50")}>
                <span className="block font-medium">{l}</span><span className="text-xs text-ink-500">{d}</span>
              </button>
            ))}
          </div>
        )}
        {f.source === "prescription" && (
          <div className="space-y-3 rounded-xl border border-champagne-300 bg-champagne-50 p-4">
            <Field label="Prescription text (as written)" hint="Type it exactly as written; Chiktsa turns it into drafts that a person must verify.">
              <Textarea rows={3} value={f.prescriptionText} onChange={(e) => set("prescriptionText", e.target.value)} placeholder="e.g. Tab Metformin 500 mg 1-0-1 after food x 30 days" />
            </Field>
            <p className="text-xs text-ink-700">Tick <strong>Unclear on prescription</strong> under any field you can't read with certainty. Unclear fields block activation until someone confirms them.</p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Medicine name" error={errors.name}><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field><UnclearToggle k="name" /></div>
          <div><Field label="Strength" hint="e.g. 500 mg"><Input value={f.strength} onChange={(e) => set("strength", e.target.value)} /></Field><UnclearToggle k="strength" /></div>
          <div><Field label="Dose amount" error={errors.doseQuantity}><Input inputMode="decimal" value={f.doseQuantity} onChange={(e) => set("doseQuantity", e.target.value)} /></Field><UnclearToggle k="doseQuantity" /></div>
          <Field label="Dose unit"><Input value={f.doseUnit} onChange={(e) => set("doseUnit", e.target.value)} /></Field>
          <Field label="Form">
            <NativeSelect value={f.form} onChange={(e) => set("form", e.target.value)}>
              {["tablet", "capsule", "liquid", "injection", "inhaler", "drops", "patch", "other"].map((x) => <option key={x} value={x}>{x}</option>)}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-3"><Field label="Frequency as written" hint="e.g. BD, twice daily, 1-0-1. Checked against the schedule below."><Input value={f.frequencyText} onChange={(e) => set("frequencyText", e.target.value)} /></Field><UnclearToggle k="frequencyText" /></div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-700">Dose times (senior's local time)</legend>
          <div className="flex flex-wrap items-center gap-2">
            {f.times.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800">
                {t}<button type="button" onClick={() => set("times", f.times.filter((x) => x !== t))} aria-label={`Remove ${t}`}><X className="size-3.5" /></button>
              </span>
            ))}
            <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-9 w-32" aria-label="New dose time" />
            <Button type="button" size="sm" variant="secondary" onClick={() => newTime && !f.times.includes(newTime) && set("times", [...f.times, newTime].sort())}><Plus /> Add time</Button>
          </div>
          <UnclearToggle k="times" />
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
            {DAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={f.daysOfWeek.includes(i)}
                onClick={() => set("daysOfWeek", f.daysOfWeek.includes(i) ? f.daysOfWeek.filter((x) => x !== i) : [...f.daysOfWeek, i].sort())}
                className={cn("h-9 w-12 rounded-lg border text-sm", f.daysOfWeek.includes(i) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-ink-500")}>{d}</button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <div><Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field><UnclearToggle k="startDate" /></div>
          <Field label="End date (optional)" error={errors.endDate}><Input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          <Field label="Prescriber"><Input value={f.prescriber} onChange={(e) => set("prescriber", e.target.value)} /></Field>
          <div className="sm:col-span-3"><Field label="Instructions" hint="e.g. after food"><Input value={f.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field><UnclearToggle k="instructions" /></div>
        </div>

        <div className="grid gap-4 rounded-xl bg-sage-50 p-4 sm:grid-cols-3">
          <Field label="Who confirms doses?" hint="Responsible for recording each dose"><MemberSelect hid={hid} seniorId={sid} value={f.responsibleUid} onChange={(v) => set("responsibleUid", v)} placeholder="Nobody yet" excludeSeniors={false} /></Field>
          <Field label="Current stock (optional)" error={errors.stockQuantity} hint={`In ${f.doseUnit || "units"}`}><Input inputMode="decimal" value={f.stockQuantity} onChange={(e) => set("stockQuantity", e.target.value)} /></Field>
          <Field label="Pharmacy (optional)"><Input value={f.pharmacy} onChange={(e) => set("pharmacy", e.target.value)} /></Field>
        </div>

        {med?.status === "active" && <p className="rounded-xl bg-warning-50 p-3 text-sm text-warning-600">Changing clinical details (dose, times, name…) moves this medication back to “awaiting verification”.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{med ? "Save changes" : "Save for verification"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function IssueList({ med, compact }: { med: Medication; compact?: boolean }) {
  if (!med.issues.length) return null;
  return (
    <ul className={cn("space-y-1.5", compact && "text-xs")}>
      {med.issues.map((i) => (
        <li key={i.code + i.field} className={cn("flex gap-2 rounded-lg px-3 py-2 text-sm", i.severity === "blocking" ? "bg-danger-50 text-danger-600" : "bg-warning-50 text-warning-600")}>
          {i.severity === "blocking" ? <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-label="Blocking" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-label="Warning" />}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function VerifyDialog({ hid, sid, med, onClose }: { hid: string; sid: string; med: Medication | null; onClose: () => void }) {
  const verify = useVerifyMed(hid, sid);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { setAck(false); setNote(""); }, [med?.id]);
  if (!med) return null;
  const blocking = med.issues.filter((i) => i.severity === "blocking");
  const warnings = med.issues.filter((i) => i.severity === "warning");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Verify ${med.name || "medication"}`}
      description="Compare every detail with the original prescription. Verifying activates the dose schedule.">
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-sage-50 p-4 text-sm">
          {[["Medicine", `${med.name || "—"} ${med.strength}`], ["Dose", `${med.doseQuantity ?? "—"} ${med.doseUnit}`], ["Frequency", med.frequencyText || "—"],
            ["Times", med.times.join(", ") || "—"], ["Starts", med.startDate ?? "—"], ["Instructions", med.instructions || "—"]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-ink-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        {med.prescriptionText && <p className="rounded-xl border border-line p-3 text-sm"><span className="text-xs text-ink-500">As written: </span>{med.prescriptionText}</p>}
        <IssueList med={med} />
        {blocking.length > 0 ? (
          <p className="text-sm font-medium text-danger-600">This medication can't be activated until the blocking issues are fixed. Edit it to resolve them.</p>
        ) : (
          <>
            {warnings.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                I've reviewed the warnings above and confirm the details match the prescription.
              </label>
            )}
            <Field label="Verification note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked against Dr Rao's prescription dated 12 Nov" /></Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={blocking.length > 0 || (warnings.length > 0 && !ack)} loading={verify.isPending}
            onClick={() => verify.mutate({ mid: med.id, acknowledgeWarnings: ack, note }, {
              onSuccess: () => { toast.success("Verified — the dose schedule is now active"); onClose(); },
              onError: (e) => toast.error(errorMessage(e)),
            })}>
            <ShieldCheck /> Verify and activate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "medication.create": "Added", "medication.update": "Edited", "medication.verify": "Verified", "medication.paused": "Paused",
  "medication.active": "Resumed", "medication.ended": "Ended", "medication.refill": "Refill recorded", "dose.record": "Dose recorded",
};

export function JourneyDialog({ hid, sid, med, onClose }: { hid: string; sid: string; med: Medication | null; onClose: () => void }) {
  const j = useJourney(hid, sid, med?.id);
  if (!med) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${med.name || "Medication"} — journey`} description="Every step from entry and verification to each recorded dose.">
      {j.isLoading ? <Skeleton className="h-40" /> : (
        <ol className="relative space-y-4 border-l-2 border-sage-200 pl-5">
          {(j.data ?? []).map((e) => (
            <li key={e.id} className="relative">
              <span className={cn("absolute -left-[1.6rem] top-1 size-3 rounded-full ring-4 ring-surface", e.action === "medication.verify" ? "bg-brand-500" : e.action === "dose.record" ? "bg-sage-400" : "bg-champagne-500")} />
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{ACTION_LABELS[e.action] ?? e.action}</p>
              <p className="text-sm">{e.summary}</p>
              <p className="text-xs text-ink-500">{e.actorName} · {fmt(e.at)}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-ink-500"><CheckCircle2 className="size-3.5" /> Read-only history from the audit trail.</div>
    </Dialog>
  );
}
