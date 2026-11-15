import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, Link2, Phone, Printer, ShieldCheck, Siren, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton, Switch } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ErrorState, Logo, PageHeader } from "@/components/common";
import { useEmergency, useEmergencyAction, type EmergencyCard } from "@/hooks/phase5-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { api, errorMessage } from "@/lib/api";
import type { Senior } from "@/lib/types";
import { NeedsSenior, ProfilePicker, fmt } from "@/features/care/shared";

const FIELDS: [string, string, boolean][] = [["bloodGroup", "Blood group", false], ["allergies", "Allergies", true], ["conditions", "Known conditions (only if the senior wants them shown)", true],
  ["mobilityNeeds", "Mobility needs", true], ["communicationNeeds", "Communication needs (hearing, language…)", true], ["preferredHospital", "Preferred hospital", false],
  ["doctorName", "Doctor", false], ["doctorPhone", "Doctor's phone", false], ["additionalNotes", "Anything responders should know", true]];

export function CardView({ card, compact }: { card: EmergencyCard; compact?: boolean }) {
  const row = (label: string, v?: string | null) => (v ? <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt><dd className="text-base">{v}</dd></div> : null);
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-danger-600/40 bg-surface">
      <div className="flex items-center gap-3 bg-danger-600 px-5 py-3 text-white"><Siren className="size-5" aria-hidden /><span className="font-semibold">Emergency information</span></div>
      <div className={compact ? "space-y-3 p-4" : "space-y-4 p-6"}>
        <p className="font-display text-2xl">{card.fullName}{card.preferredName && <span className="text-ink-500"> (“{card.preferredName}”)</span>}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {row("Date of birth", card.dateOfBirth)}{row("Language", card.primaryLanguage === "hi" ? "Hindi" : card.primaryLanguage === "en" ? "English" : card.primaryLanguage)}
          {row("Blood group", card.bloodGroup)}{row("Allergies", card.allergies)}{row("Known conditions", card.conditions)}{row("Mobility", card.mobilityNeeds)}
          {row("Communication", card.communicationNeeds)}{row("Preferred hospital", card.preferredHospital)}{row("Doctor", [card.doctorName, card.doctorPhone].filter(Boolean).join(" · "))}
          {row("Notes", card.additionalNotes)}
        </dl>
        {card.medications.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Current verified medicines</p>
          <ul className="mt-1 space-y-0.5">{card.medications.map((m) => <li key={m.name}>{m.name} {m.strength} — {m.dose} at {m.times.join(", ")}</li>)}</ul></div>}
        {card.contacts.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Emergency contacts</p>
          <ul className="mt-1 space-y-1">{card.contacts.map((c) => <li key={c.phone}><a className="inline-flex items-center gap-2 text-brand-700 underline" href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}><Phone className="size-4" />{c.name}{c.relationship && ` (${c.relationship})`} · {c.phone}</a></li>)}</ul></div>}
      </div>
    </div>
  );
}

function Editor({ hid, senior }: { hid: string; senior: Senior }) {
  const e = useEmergency(hid, senior.id);
  const act = useEmergencyAction(hid, senior.id);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({ medications: true, contacts: true, conditions: true });
  const [hours, setHours] = useState("24");
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => { if (e.data) { setFields(e.data.fields); setInclude({ medications: true, contacts: true, conditions: true, ...e.data.include }); } }, [e.data]);
  if (e.isLoading) return <Skeleton className="h-96" />;
  if (e.isError) return <ErrorState error={e.error} />;
  const d = e.data!;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Card details</CardTitle><CardDescription>Only what {senior.preferredName || senior.fullName} agrees to share. Saving changes means it must be approved again.</CardDescription></CardHeader>
          <CardContent>
            <fieldset disabled={!d.canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">{FIELDS.map(([k, label, long]) => (
                <Field key={k} label={label} className={long ? "sm:col-span-2" : ""}>
                  {k === "bloodGroup" ? <NativeSelect value={fields[k] ?? ""} onChange={(ev) => setFields({ ...fields, [k]: ev.target.value })}><option value="">Not recorded</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}</NativeSelect>
                    : long ? <Textarea rows={2} maxLength={500} value={fields[k] ?? ""} onChange={(ev) => setFields({ ...fields, [k]: ev.target.value })} />
                      : <Input maxLength={120} value={fields[k] ?? ""} onChange={(ev) => setFields({ ...fields, [k]: ev.target.value })} />}
                </Field>))}</div>
              <div className="space-y-2 rounded-xl bg-sage-50 p-3 text-sm">
                {([["medications", "Include verified medicines"], ["contacts", "Include emergency contacts"], ["conditions", "Show known conditions"]] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center justify-between gap-3">{l}<Switch checked={include[k] !== false} onCheckedChange={(v) => setInclude({ ...include, [k]: v })} aria-label={l} /></label>))}
              </div>
              {d.canEdit && <div className="flex justify-end"><Button loading={act.isPending} onClick={() => act.mutate({ action: "save", fields, include }, { onSuccess: () => toast.success("Saved — approval needed"), onError: (er) => toast.error(errorMessage(er)) })}>Save details</Button></div>}
            </fieldset>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {d.status === "approved" ? <Badge tone="brand"><CheckCircle2 className="size-3" /> Approved by {d.approvedByName}{d.approvedAs === "admin_on_behalf" && " on the senior's behalf"} · {fmt(d.approvedAt, undefined, { dateStyle: "medium" })}</Badge> : <Badge tone="warning">Draft — not yet approved</Badge>}
          {d.status === "draft" && d.canApprove && <Button size="sm" onClick={() => act.mutate({ action: "approve" }, { onSuccess: () => toast.success("Approved"), onError: (er) => toast.error(errorMessage(er)) })}><ShieldCheck /> Approve this card</Button>}
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
        </div>
        <CardView card={d.card} />
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="size-4" /> Temporary share link</CardTitle>
            <CardDescription>For a hospital, ambulance crew or neighbour. Shows only this approved card, expires automatically, can be revoked, and every view is logged.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.status !== "approved" ? <p className="text-ink-500">Approve the card first.</p> : <>
              <div className="flex gap-2">
                <NativeSelect value={hours} onChange={(ev) => setHours(ev.target.value)} aria-label="Link lifetime">{[["2", "2 hours"], ["24", "24 hours"], ["72", "3 days"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                <Button loading={act.isPending} onClick={() => act.mutate({ action: "share", hours: Number(hours) }, { onSuccess: (r) => setLink(`${window.location.origin}/emergency/${(r as { token: string }).token}`), onError: (er) => toast.error(errorMessage(er)) })}>Create link</Button>
              </div>
              {link && <div className="flex gap-2"><Input readOnly value={link} onFocus={(ev) => ev.currentTarget.select()} aria-label="Emergency link" />
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Copied"), () => toast.error("Copy it manually"))}><Copy /> Copy</Button></div>}
              {d.shares.length > 0 && <ul className="divide-y divide-line rounded-xl border border-line">{d.shares.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3"><span className="flex-1">Expires {fmt(s.expiresAt)} · viewed {s.views}×{s.lastViewedAt && ` (last ${fmt(s.lastViewedAt, undefined, { timeStyle: "short" })})`}</span>
                  <Button size="icon" variant="ghost" aria-label="Revoke link" onClick={() => act.mutate({ action: "unshare", id: s.id }, { onSuccess: () => toast.success("Link revoked") })}><Trash2 /></Button></li>))}</ul>}
            </>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function EmergencyPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Emergency Snapshot" description="A senior-approved card with exactly what responders need — nothing more." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <Editor key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}

/** Public, token-gated page (no sign-in). Shows only the approved card. */
export function PublicEmergencyPage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["public-emergency", token], queryFn: () => api.get<{ card: EmergencyCard; expiresAt: string; notice: string }>(`/public/emergency/${encodeURIComponent(token)}`), retry: false });
  useEffect(() => {
    const m = document.createElement("meta"); m.name = "robots"; m.content = "noindex, nofollow"; document.head.appendChild(m);
    document.title = "Emergency information";
    return () => { m.remove(); };
  }, []);
  return (
    <div className="min-h-screen bg-ivory px-4 py-8">
      <div className="mx-auto max-w-xl space-y-4">
        <Logo />
        {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? <ErrorState error={q.error} /> : <>
          <CardView card={q.data!.card} />
          <p className="text-xs text-ink-500">{q.data!.notice} Link expires {fmt(q.data!.expiresAt)}.</p>
          <Button asChild variant="danger" size="lg" className="w-full"><a href="tel:112"><Phone /> Call emergency services (112)</a></Button>
        </>}
      </div>
    </div>
  );
}
