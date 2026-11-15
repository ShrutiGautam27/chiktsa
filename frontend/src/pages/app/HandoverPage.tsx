import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, CalendarOff, CheckCircle2, Clock, LifeBuoy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useAbsences, useAckHandover, useCancelAbsence, useCover, useCreateHandover, useHandovers, useReportAbsence } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe, useSeniors } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Absence, Handover } from "@/lib/care-types";
import { DualTime, MemberSelect, fmt, toLocalInput } from "@/features/care/shared";

function HandoverDialog({ hid, open, onOpenChange }: { hid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateHandover(hid);
  const seniors = useSeniors(hid);
  const [to, setTo] = useState("");
  const [sids, setSids] = useState<string[]>([]);
  const [obs, setObs] = useState("");
  const [changes, setChanges] = useState("");
  const [instr, setInstr] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to) return setErr("Choose who is taking over");
    if (!sids.length) return setErr("Choose at least one elderly profile");
    try {
      await create.mutateAsync({ toUid: to, seniorIds: sids, observations: obs, instructions: instr, scheduleChanges: changes });
      toast.success("Handover sent — they'll be asked to acknowledge it");
      onOpenChange(false);
      setTo(""); setSids([]); setObs(""); setChanges(""); setInstr([]);
    } catch (e2) {
      toast.error(errorMessage(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl" title="Create a handover passport"
      description="Completed and pending tasks, upcoming appointments and medication changes are attached automatically from the records.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {err && <p role="alert" className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{err}</p>}
        <Field label="Handing over to"><MemberSelect hid={hid} value={to} onChange={(v) => { setTo(v); setErr(""); }} placeholder="Choose a caregiver" filter={(r) => ["household_owner", "family_admin", "primary_caregiver", "secondary_caregiver", "org_admin"].includes(r)} /></Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-700">Profiles covered</legend>
          <div className="flex flex-wrap gap-2">{seniors.data?.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" aria-label={s.fullName} className="size-4 accent-brand-600" checked={sids.includes(s.id)} onChange={() => setSids(sids.includes(s.id) ? sids.filter((x) => x !== s.id) : [...sids, s.id])} />{s.fullName}
            </label>))}</div>
        </fieldset>
        <Field label="Important observations" hint="Non-diagnostic notes: mood, appetite, sleep, anything the next person should know."><Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <Field label="Schedule changes"><Input value={changes} onChange={(e) => setChanges(e.target.value)} /></Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-700">Outstanding instructions</legend>
          <ul className="mb-2 space-y-1">{instr.map((i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-sage-50 px-3 py-1.5 text-sm"><span className="flex-1">{i}</span><button type="button" aria-label="Remove" onClick={() => setInstr(instr.filter((x) => x !== i))}><X className="size-3.5" /></button></li>)}</ul>
          <div className="flex gap-2"><Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Call the clinic about Tuesday's report" aria-label="New instruction" />
            <Button type="button" variant="secondary" onClick={() => { if (draft.trim()) { setInstr([...instr, draft.trim()]); setDraft(""); } }}><Plus /> Add</Button></div>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={create.isPending}><ArrowRightLeft /> Send handover</Button></div>
      </form>
    </Dialog>
  );
}

function Passport({ hid, h }: { hid: string; h: Handover }) {
  const me = useMe();
  const ack = useAckHandover();
  const [note, setNote] = useState("");
  const s = h.snapshot;
  const forMe = h.toUid === me.data?.user.uid && h.status === "pending";
  return (
    <Card className={forMe ? "border-brand-500" : ""}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{h.fromName} → {h.toName}</CardTitle>
          <CardDescription>{Object.values(h.seniorNames).join(", ")} · {fmt(h.createdAt)}</CardDescription>
        </div>
        {h.status === "acknowledged" ? <Badge tone="brand"><CheckCircle2 className="size-3" /> Acknowledged {h.acknowledgedAt && fmt(h.acknowledgedAt, undefined, { dateStyle: "short", timeStyle: "short" })}</Badge> : <Badge tone="warning"><Clock className="size-3" /> Awaiting acknowledgement</Badge>}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {h.observations && <div><h4 className="text-xs font-semibold uppercase text-ink-500">Observations</h4><p className="whitespace-pre-wrap">{h.observations}</p></div>}
        {h.instructions.length > 0 && <div><h4 className="text-xs font-semibold uppercase text-ink-500">Outstanding instructions</h4><ul className="list-disc pl-5">{h.instructions.map((i) => <li key={i}>{i}</li>)}</ul></div>}
        {h.scheduleChanges && <div><h4 className="text-xs font-semibold uppercase text-ink-500">Schedule changes</h4><p>{h.scheduleChanges}</p></div>}
        <div className="grid gap-4 rounded-xl bg-sage-50 p-4 sm:grid-cols-2">
          <div><h4 className="mb-1 text-xs font-semibold uppercase text-ink-500">Completed since {fmt(s.since, undefined, { dateStyle: "short", timeStyle: "short" })}</h4>
            {s.completedTasks.length ? <ul className="space-y-0.5">{s.completedTasks.map((t) => <li key={t.id}>✓ {t.title} <span className="text-ink-500">({t.completedByName})</span></li>)}</ul> : <p className="text-ink-500">No tasks completed.</p>}
            {!s.medicationDetailsRestricted && (s.dosesRecorded.taken || s.dosesRecorded.skipped) ? <p className="mt-1 text-ink-500">Doses recorded: {s.dosesRecorded.taken ?? 0} taken, {s.dosesRecorded.skipped ?? 0} skipped</p> : null}
          </div>
          <div><h4 className="mb-1 text-xs font-semibold uppercase text-ink-500">Still pending</h4>
            {s.pendingTasks.length ? <ul className="space-y-0.5">{s.pendingTasks.map((t) => <li key={t.id}>• {t.title} <span className="text-ink-500">({t.assigneeName ?? "unassigned"})</span></li>)}</ul> : <p className="text-ink-500">Nothing pending.</p>}
          </div>
          <div><h4 className="mb-1 text-xs font-semibold uppercase text-ink-500">Appointments (next 7 days)</h4>
            {s.upcomingAppointments.length ? <ul className="space-y-0.5">{s.upcomingAppointments.map((a) => <li key={a.id}>{a.title} · <DualTime iso={a.startsAt} />{a.postponedSinceLastHandover && <Badge tone="info" className="ml-1">moved</Badge>}</li>)}</ul> : <p className="text-ink-500">None.</p>}
          </div>
          <div><h4 className="mb-1 text-xs font-semibold uppercase text-ink-500">Medication changes</h4>
            {s.medicationDetailsRestricted ? <p className="text-ink-500">Restricted by the senior's consent settings.</p>
              : s.medicationChanges.length ? <ul className="space-y-0.5">{s.medicationChanges.map((c, i) => <li key={i}>{c.summary} <span className="text-ink-500">({c.by})</span></li>)}</ul> : <p className="text-ink-500">No changes.</p>}
          </div>
        </div>
        {h.acknowledgementNote && <p className="text-ink-700"><strong>{h.toName}:</strong> {h.acknowledgementNote}</p>}
        {forMe && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note back" aria-label="Acknowledgement note" />
            <Button loading={ack.isPending} onClick={() => ack.mutate({ hid, id: h.id, note }, { onSuccess: () => toast.success("Handover acknowledged"), onError: (e) => toast.error(errorMessage(e)) })}><CheckCircle2 /> Acknowledge</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AbsenceDialog({ hid, open, onOpenChange }: { hid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const report = useReportAbsence(hid);
  const [start, setStart] = useState(toLocalInput(new Date()));
  const [end, setEnd] = useState(toLocalInput(new Date(Date.now() + 2 * 86400000)));
  const [reason, setReason] = useState("");
  const valid = start && end && new Date(end) > new Date(start) && new Date(end) > new Date();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="I'm unavailable" description="CareHub finds your assigned responsibilities in this period, asks authorised backups to cover them and lets the family know.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Until" error={end && !valid ? "Must end after it starts, in the future" : undefined}><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Reason (optional, shared with the family)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid} loading={report.isPending} onClick={() => report.mutate({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), reason }, {
            onSuccess: (a) => { toast.success(a.items.length ? `${a.items.length} responsibilities flagged for cover` : "Absence recorded — nothing needed cover"); onOpenChange(false); },
            onError: (e) => toast.error(errorMessage(e)),
          })}><CalendarOff /> Start absence protocol</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AbsenceCard({ hid, a }: { hid: string; a: Absence }) {
  const me = useMe();
  const cover = useCover();
  const cancel = useCancelAbsence(hid);
  const { can } = useCareContext();
  const uid = me.data?.user.uid;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div><CardTitle>{a.name} is unavailable</CardTitle><CardDescription><DualTime iso={a.startsAt} /> → <DualTime iso={a.endsAt} />{a.reason && ` · ${a.reason}`}</CardDescription></div>
        <div className="flex items-center gap-2">
          {a.status === "cancelled" ? <Badge>Cancelled</Badge> : a.uncovered ? <Badge tone="warning">{a.uncovered} need cover</Badge> : <Badge tone="brand">All covered</Badge>}
          {a.status === "active" && (a.uid === uid || can("members.manage")) && <Button size="icon" variant="ghost" aria-label="Cancel absence" onClick={() => cancel.mutate(a.id, { onSuccess: () => toast.success("Absence cancelled"), onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /></Button>}
        </div>
      </CardHeader>
      <CardContent>
        {a.items.length === 0 ? <p className="text-sm text-ink-500">No assigned responsibilities fell in this period.</p> : (
          <ul className="space-y-2">{a.items.map((it) => {
            const canCover = !it.coveredBy && a.status === "active" && it.candidates.some((c) => c.uid === uid);
            return (
              <li key={it.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 font-medium">{it.title}{it.seniorName && <span className="font-normal text-ink-500"> · {it.seniorName}</span>}</span>
                  {it.coveredBy ? <Badge tone="brand">Covered by {it.coveredByName}</Badge> : canCover ? (
                    <Button size="sm" loading={cover.isPending} onClick={() => cover.mutate({ hid, absenceId: a.id, itemType: it.type, itemId: it.id }, { onSuccess: () => toast.success("You're covering this"), onError: (e) => toast.error(errorMessage(e)) })}><LifeBuoy /> I'll cover</Button>
                  ) : <Badge tone="warning">Needs cover</Badge>}
                </div>
                {!it.coveredBy && <p className="mt-1 text-xs text-ink-500">Authorised backups: {it.candidates.length ? it.candidates.map((c) => c.displayName).join(", ") : <span className="text-danger-600">none available — an administrator must reassign</span>}</p>}
              </li>
            );
          })}</ul>
        )}
      </CardContent>
    </Card>
  );
}

export function HandoverPage() {
  const { householdId, membership, can } = useCareContext();
  const handovers = useHandovers(householdId ?? undefined);
  const absences = useAbsences(householdId ?? undefined);
  const [newHandover, setNewHandover] = useState(false);
  const [newAbsence, setNewAbsence] = useState(false);
  if (!householdId) return <EmptyState icon={ArrowRightLeft} title="No household selected" description="Create or join a household first." />;
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Caregiver handover" description="Handover passports keep continuity between caregivers; the absence protocol makes sure nothing is dropped when someone is away."
        actions={<>
          {can("tasks.update_assigned") && <Button variant="outline" onClick={() => setNewAbsence(true)}><CalendarOff /> I'm unavailable</Button>}
          {can("handover.write") && <Button onClick={() => setNewHandover(true)}><ArrowRightLeft /> New handover</Button>}
        </>} />
      <Tabs defaultValue="handovers">
        <TabsList><TabsTrigger value="handovers">Handover passports</TabsTrigger><TabsTrigger value="absences">Absences & cover</TabsTrigger></TabsList>
        <TabsContent value="handovers">
          {handovers.isLoading ? <Skeleton className="h-48" /> : handovers.isError ? <ErrorState error={handovers.error} /> : !handovers.data?.length
            ? <EmptyState icon={ArrowRightLeft} title="No handovers yet" description="When you finish a shift, send a handover so the next person knows exactly where things stand." />
            : <div className="space-y-4">{handovers.data.map((h) => <Passport key={h.id} hid={householdId} h={h} />)}</div>}
        </TabsContent>
        <TabsContent value="absences">
          {absences.isLoading ? <Skeleton className="h-48" /> : absences.isError ? <ErrorState error={absences.error} /> : !absences.data?.length
            ? <EmptyState icon={CalendarOff} title="No current absences" description="If you'll be away, start the absence protocol so authorised backups can take over." />
            : <div className="space-y-4">{absences.data.map((a) => <AbsenceCard key={a.id} hid={householdId} a={a} />)}</div>}
        </TabsContent>
      </Tabs>
      <HandoverDialog hid={householdId} open={newHandover} onOpenChange={setNewHandover} />
      <AbsenceDialog hid={householdId} open={newAbsence} onOpenChange={setNewAbsence} />
    </>
  );
}
