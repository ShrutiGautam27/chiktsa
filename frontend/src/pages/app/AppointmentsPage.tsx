import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, ClipboardCheck, Clock, HandHelping, MapPin, MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { VisitPrepDialog } from "@/features/ai/components";
import { CalendarButtons } from "@/features/phase5/components";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useAppointmentAction, useAppointments, useSaveAppointment } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Appointment } from "@/lib/care-types";
import type { Senior } from "@/lib/types";
import { DualTime, MemberSelect, NeedsSenior, ProfilePicker, fmt, toLocalInput } from "@/features/care/shared";

function AppointmentDialog({ hid, sid, open, onOpenChange }: { hid: string; sid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveAppointment(hid, sid);
  const [v, setV] = useState({ title: "", providerName: "", location: "", startsAt: toLocalInput(new Date(Date.now() + 86400000)), durationMinutes: "30", notes: "", questions: "", escortUid: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!v.title.trim()) errs.title = "Enter a title";
    if (!v.startsAt || new Date(v.startsAt) <= new Date()) errs.startsAt = "Choose a future date and time";
    const dur = Number(v.durationMinutes);
    if (!(dur >= 5 && dur <= 600)) errs.durationMinutes = "Between 5 and 600 minutes";
    setErr(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync({
        title: v.title.trim(), providerName: v.providerName.trim(), location: v.location.trim(), startsAt: new Date(v.startsAt).toISOString(),
        durationMinutes: dur, notes: v.notes, questions: v.questions.split("\n").map((q) => q.trim()).filter(Boolean), escortUid: v.escortUid || null,
      });
      toast.success("Appointment scheduled");
      onOpenChange(false);
    } catch (e2) {
      toast.error(errorMessage(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Schedule an appointment" description="Times are entered in your own time zone and shown to each family member in theirs.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Title" error={err.title}><Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Cardiology follow-up" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Doctor / provider"><Input value={v.providerName} onChange={(e) => set("providerName", e.target.value)} /></Field>
          <Field label="Location"><Input value={v.location} onChange={(e) => set("location", e.target.value)} /></Field>
          <Field label="Date and time" error={err.startsAt}><Input type="datetime-local" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></Field>
          <Field label="Duration (minutes)" error={err.durationMinutes}><Input inputMode="numeric" value={v.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} /></Field>
        </div>
        <Field label="Who will accompany?" hint="They'll be asked to confirm."><MemberSelect hid={hid} seniorId={sid} value={v.escortUid} onChange={(x) => set("escortUid", x)} placeholder="Not decided yet" /></Field>
        <Field label="Questions for the doctor (one per line)"><Textarea rows={3} value={v.questions} onChange={(e) => set("questions", e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Schedule</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PostponeDialog({ hid, appt, onClose }: { hid: string; appt: Appointment | null; onClose: () => void }) {
  const action = useAppointmentAction(hid);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  if (!appt) return null;
  const valid = when && new Date(when) > new Date();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Postpone ${appt.title}`} description="The accompanying person will be asked to re-confirm. The change is kept in the appointment history.">
      <div className="space-y-4">
        <Field label="New date and time" error={when && !valid ? "Choose a future time" : undefined}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={action.isPending} onClick={() => action.mutate({ sid: appt.seniorId, aid: appt.id, action: "postpone", body: { newStartsAt: new Date(when).toISOString(), reason } }, {
            onSuccess: () => { toast.success("Appointment postponed"); onClose(); }, onError: (e) => toast.error(errorMessage(e)),
          })}>Postpone</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AppointmentRow({ hid, appt, senior }: { hid: string; appt: Appointment; senior?: Senior }) {
  const me = useMe();
  const { can } = useCareContext();
  const action = useAppointmentAction(hid);
  const [postponing, setPostponing] = useState(false);
  const [prepping, setPrepping] = useState(false);
  const uid = me.data?.user.uid;
  const run = (a: "escort" | "complete" | "cancel", body?: unknown, msg = "Updated") =>
    action.mutate({ sid: appt.seniorId, aid: appt.id, action: a, body }, { onSuccess: () => toast.success(msg), onError: (e) => toast.error(errorMessage(e)) });
  const past = new Date(appt.startsAt) < new Date();
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-16 shrink-0 rounded-xl bg-brand-50 py-2 text-center text-brand-800">
          <div className="text-xs uppercase">{fmt(appt.startsAt, me.data?.user.timezone, { month: "short" })}</div>
          <div className="font-display text-2xl leading-none">{fmt(appt.startsAt, me.data?.user.timezone, { day: "numeric" })}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{appt.title}</h3>
            {appt.status !== "scheduled" && <Badge tone={appt.status === "completed" ? "sage" : "neutral"}>{appt.status}</Badge>}
            {appt.history.length > 0 && <Badge tone="info">Postponed ×{appt.history.length}</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-700">
            <span className="inline-flex items-center gap-1"><Clock className="size-3.5 text-ink-500" /><DualTime iso={appt.startsAt} seniorTz={senior?.timezone} /></span>
            {appt.providerName && <span>{appt.providerName}</span>}
            {appt.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-ink-500" />{appt.location}</span>}
          </p>
          <p className="mt-1 text-sm">
            {appt.escortName ? (
              <span className={appt.escortAccepted ? "text-brand-700" : "text-warning-600"}>
                {appt.escortAccepted ? <UserCheck className="mr-1 inline size-4" /> : <Clock className="mr-1 inline size-4" />}
                {appt.escortName} {appt.escortAccepted ? "will accompany" : "— awaiting confirmation"}{appt.coverNeeded ? " (unavailable — cover needed)" : ""}
              </span>
            ) : <span className="text-danger-600"><UserX className="mr-1 inline size-4" />No one assigned to accompany</span>}
          </p>
          {appt.questions.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-ink-500">{appt.questions.map((q) => <li key={q}>{q}</li>)}</ul>}
          {appt.status === "scheduled" && <div className="mt-2"><CalendarButtons hid={hid} appt={appt} /></div>}
        </div>
        {appt.status === "scheduled" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPrepping(true)}><ClipboardCheck /> Prepare</Button>
            {appt.escortUid === uid && !appt.escortAccepted && <Button size="sm" onClick={() => run("escort", { action: "accept" }, "Thanks — you're confirmed")}>Confirm I'll go</Button>}
            {!appt.escortUid && can("tasks.update_assigned") && <Button size="sm" variant="secondary" onClick={() => run("escort", { action: "volunteer" }, "You're accompanying this visit")}><HandHelping /> I'll accompany</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-lg p-2 hover:bg-sage-100" aria-label={`Actions for ${appt.title}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent>
                {appt.escortUid === uid && <DropdownMenuItem onSelect={() => run("escort", { action: "decline" }, "You've stepped back from this visit")}>I can't go</DropdownMenuItem>}
                {can("senior.medical.write") && <DropdownMenuItem onSelect={() => setPostponing(true)}>Postpone</DropdownMenuItem>}
                {can("senior.medical.write") && past && <DropdownMenuItem onSelect={() => run("complete", { visitNotes: "" }, "Marked completed")}>Mark completed</DropdownMenuItem>}
                {can("senior.medical.write") && <DropdownMenuItem className="text-danger-600" onSelect={() => run("cancel", undefined, "Appointment cancelled")}>Cancel appointment</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {postponing && <PostponeDialog hid={hid} appt={appt} onClose={() => setPostponing(false)} />}
      {prepping && <VisitPrepDialog hid={hid} sid={appt.seniorId} aid={appt.id} onClose={() => setPrepping(false)} />}
    </Card>
  );
}

function SeniorAppointments({ hid, senior }: { hid: string; senior: Senior }) {
  const appts = useAppointments(hid, senior.id);
  const { can } = useCareContext();
  const [open, setOpen] = useState(false);
  const upcoming = (appts.data ?? []).filter((a) => a.status === "scheduled");
  const past = (appts.data ?? []).filter((a) => a.status !== "scheduled").reverse();
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl">Upcoming for {senior.preferredName || senior.fullName}</h2>
        {can("senior.medical.write") && <Button onClick={() => setOpen(true)}><CalendarPlus /> Schedule</Button>}
      </div>
      {appts.isLoading ? <Skeleton className="h-32" /> : appts.isError ? <ErrorState error={appts.error} onRetry={() => appts.refetch()} /> : (
        <div className="space-y-3">
          {upcoming.length === 0 && <EmptyState icon={CalendarDays} title="No upcoming appointments" description="Schedule visits and make sure someone is assigned to accompany each one." />}
          {upcoming.map((a) => <AppointmentRow key={a.id} hid={hid} appt={a} senior={senior} />)}
          {past.length > 0 && (
            <section className="pt-6">
              <h2 className="mb-3 font-display text-xl">Doctor visit timeline</h2>
              <ol className="space-y-2 border-l-2 border-sage-200 pl-5">
                {past.map((a) => (
                  <li key={a.id} className="text-sm"><span className="font-medium">{a.title}</span> · {fmt(a.startsAt)} · <Badge tone={a.status === "completed" ? "sage" : "neutral"}>{a.status}</Badge></li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      {open && <AppointmentDialog hid={hid} sid={senior.id} open={open} onOpenChange={setOpen} />}
    </>
  );
}

export function AppointmentsPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Appointments" description="Every visit, who's accompanying, and the full history — shown in each family member's own time zone." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <SeniorAppointments key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}
