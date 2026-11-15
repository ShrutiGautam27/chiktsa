import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bell, BellRing, Check, CheckCheck, Clock, Mail, Moon, Play, Plus, Smartphone, SkipForward, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton, Switch } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import {
  useAcknowledge, useDeliveryPrefs, useMarkRead, useNotifications, useRecordDoseFromNotification, useReminders, useRules,
  useRunReminders, useSaveDeliveryPrefs, useSaveRules,
} from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { errorMessage } from "@/lib/api";
import type { AppNotification, Delivery, NotificationRules } from "@/lib/care-types";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { fmt } from "@/features/care/shared";

const DELIVERY_LABEL: Record<string, string> = {
  delivered: "delivered", skipped_not_configured: "not configured", skipped_no_device: "no device", failed: "failed",
};

function DeliveryChips({ deliveries }: { deliveries?: Delivery[] }) {
  if (!deliveries?.length) return null;
  const icon = { in_app: Bell, email: Mail, push: Smartphone };
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {deliveries.map((d) => {
        const I = icon[d.channel];
        return (
          <span key={d.channel} title={`${d.channel}: ${DELIVERY_LABEL[d.status] ?? d.status}`}
            className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
              d.status === "delivered" ? "bg-brand-50 text-brand-700" : d.status === "failed" ? "bg-danger-50 text-danger-600" : "bg-ivory-deep text-ink-500")}>
            <I className="size-3" aria-hidden /> {d.channel === "in_app" ? "in-app" : d.channel} · {DELIVERY_LABEL[d.status] ?? d.status}
          </span>
        );
      })}
    </span>
  );
}

export function InboxItem({ n }: { n: AppNotification }) {
  const ack = useAcknowledge();
  const mark = useMarkRead();
  const dose = useRecordDoseFromNotification();
  const doseMeta = (n.kind === "dose_reminder" || n.kind === "dose_escalation") && n.meta?.medicationId && n.meta.seniorId && n.meta.scheduledFor && n.householdId;
  const record = (status: "taken" | "skipped") =>
    dose.mutate({ hid: n.householdId!, sid: n.meta!.seniorId!, medicationId: n.meta!.medicationId!, scheduledFor: n.meta!.scheduledFor!, status }, {
      onSuccess: () => { toast.success(status === "taken" ? "Recorded as taken" : "Recorded as skipped"); mark.mutate(n.id); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <li className={cn("flex flex-wrap items-start gap-3 p-4", !n.read && "bg-brand-50/50")}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-500")} aria-hidden />{!n.read && <span className="sr-only">Unread: </span>}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{n.title}</p>
        <p className="text-sm text-ink-700">{n.body}</p>
        <p className="text-xs text-ink-500">{relativeTime(n.createdAt)}{n.acknowledgedAt && " · acknowledged"}</p>
        <DeliveryChips deliveries={n.deliveries} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {doseMeta && <>
          <Button size="sm" onClick={() => record("taken")} loading={dose.isPending}><Check /> Taken</Button>
          <Button size="sm" variant="ghost" onClick={() => record("skipped")}><SkipForward /> Skipped</Button>
        </>}
        {n.ackRequired && !n.acknowledgedAt && (
          <Button size="sm" variant="secondary" loading={ack.isPending} title="Tells the family you're handling it. It doesn't record the dose."
            onClick={() => ack.mutate({ id: n.id, hid: n.householdId }, { onSuccess: () => toast.success("Acknowledged — further escalation stopped"), onError: (e) => toast.error(errorMessage(e)) })}>
            I'm on it
          </Button>
        )}
        <Button asChild size="sm" variant="ghost" onClick={() => !n.read && mark.mutate(n.id)}><Link to={n.link}>Open</Link></Button>
      </div>
    </li>
  );
}

function Inbox() {
  const n = useNotifications();
  const mark = useMarkRead();
  if (n.isLoading) return <Skeleton className="h-64" />;
  if (n.isError) return <ErrorState error={n.error} />;
  if (!n.data?.items.length) return <EmptyState icon={Bell} title="No notifications" description="You'll be notified here when something needs you." />;
  return (
    <>
      {n.data.unread > 0 && <div className="mb-3 flex justify-end"><Button variant="outline" size="sm" onClick={() => mark.mutate(undefined)}><CheckCheck /> Mark all read</Button></div>}
      <Card><ul className="divide-y divide-line">{n.data.items.map((x) => <InboxItem key={x.id} n={x} />)}</ul></Card>
    </>
  );
}

const STATUS: Record<string, { label: string; tone: "info" | "warning" | "brand" | "sage" }> = {
  sent: { label: "Reminder sent", tone: "info" }, escalated: { label: "Escalated", tone: "warning" },
  acknowledged: { label: "Acknowledged", tone: "brand" }, resolved: { label: "Dose recorded", tone: "sage" },
};

function Activity({ hid }: { hid: string }) {
  const r = useReminders(hid);
  const run = useRunReminders(hid);
  const { can } = useCareContext();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-ink-500">Reminders are checked automatically every minute. An unconfirmed reminder never means a dose was missed.</p>
        {can("household.manage") && <Button variant="outline" size="sm" loading={run.isPending}
          onClick={() => run.mutate(undefined, { onSuccess: (s) => toast.success(`Checked: ${s.notifications} new notification(s)`), onError: (e) => toast.error(errorMessage(e)) })}><Play /> Check now</Button>}
      </div>
      {r.isLoading ? <Skeleton className="h-48" /> : r.isError ? <ErrorState error={r.error} /> : !r.data?.length ? (
        <EmptyState icon={BellRing} title="No reminder activity yet" description="Dose reminders appear here with who was notified, escalations and acknowledgements." />
      ) : (
        <Card><ul className="divide-y divide-line">{r.data.map((x) => (
          <li key={x.id} className="p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{x.kind === "dose" ? "Dose reminder" : "Low-stock alert"}{x.medicationName ? ` · ${x.medicationName}` : ""}</span>
              {x.seniorName && <Badge tone="neutral">{x.seniorName}</Badge>}
              <Badge tone={STATUS[x.status]?.tone ?? "info"}>{STATUS[x.status]?.label ?? x.status}</Badge>
              {x.heldUntil && x.status !== "resolved" && <Badge tone="info"><Moon className="size-3" /> Held for quiet hours</Badge>}
            </div>
            <ol className="mt-2 space-y-0.5 border-l-2 border-sage-200 pl-3 text-xs text-ink-700">
              {x.scheduledFor && <li><Clock className="mr-1 inline size-3" />{x.kind === "dose" ? "Due" : "Sent"} {fmt(x.scheduledFor)} — notified {x.recipients.join(", ") || "nobody"}</li>}
              {x.escalations.map((e) => <li key={e.step}>Escalation {e.step} at {fmt(e.at, undefined, { timeStyle: "short" })} → {e.recipients.join(", ")}</li>)}
              {x.acknowledgedByName && <li>Acknowledged by {x.acknowledgedByName} {x.acknowledgedAt && relativeTime(x.acknowledgedAt)}</li>}
              {x.resolvedAt && <li>Resolved {relativeTime(x.resolvedAt)}</li>}
            </ol>
          </li>))}</ul></Card>
      )}
    </div>
  );
}

const STEP_ROLES: Role[] = ["primary_caregiver", "secondary_caregiver", "family_admin", "household_owner", "family_member", "org_admin"];

function RulesEditor({ hid }: { hid: string }) {
  const rules = useRules(hid);
  const save = useSaveRules(hid);
  const { can } = useCareContext();
  const editable = can("household.manage");
  const [r, setR] = useState<NotificationRules | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (rules.data) setR(rules.data); }, [rules.data]);
  if (rules.isLoading || !r) return <Skeleton className="h-64" />;
  if (rules.isError) return <ErrorState error={rules.error} />;
  const set = <K extends keyof NotificationRules>(k: K, v: NotificationRules[K]) => setR({ ...r, [k]: v });
  const steps = r.escalationSteps;
  const submit = () => {
    const mins = steps.map((s) => s.afterMinutes);
    if (mins.some((m) => !(m >= 5)) || mins.join() !== [...mins].sort((a, b) => a - b).join() || new Set(mins).size !== mins.length) return setErr("Escalation delays must be at least 5 minutes and increase step by step.");
    if (steps.some((s) => !s.roles.length)) return setErr("Each escalation step needs at least one role.");
    setErr("");
    save.mutate(r, { onSuccess: () => toast.success("Rules saved"), onError: (e) => toast.error(errorMessage(e)) });
  };
  return (
    <fieldset disabled={!editable} className="space-y-6">
      {!editable && <p className="rounded-xl bg-sage-50 p-3 text-sm text-ink-500">Only household administrators can change these rules.</p>}
      <Card>
        <CardHeader><CardTitle>Medication reminders & escalation</CardTitle><CardDescription>Who hears about a dose nobody has recorded, and when.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-4 text-sm"><span>Send a reminder at each dose time</span><Switch checked={r.doseReminders} onCheckedChange={(v) => set("doseReminders", v)} aria-label="Dose reminders" /></label>
          {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{err}</p>}
          <ol className="space-y-3">{steps.map((s, i) => (
            <li key={i} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Step {i + 1}: if still unconfirmed after</span>
                <Input aria-label={`Step ${i + 1} delay in minutes`} inputMode="numeric" className="h-9 w-20" value={s.afterMinutes}
                  onChange={(e) => set("escalationSteps", steps.map((x, j) => j === i ? { ...x, afterMinutes: Number(e.target.value) || 0 } : x))} />
                <span>minutes, notify:</span>
                {steps.length > 1 && <Button type="button" size="icon" variant="ghost" className="ml-auto" aria-label={`Remove step ${i + 1}`} onClick={() => set("escalationSteps", steps.filter((_, j) => j !== i))}><Trash2 /></Button>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{STEP_ROLES.map((role) => (
                <button key={role} type="button" aria-pressed={s.roles.includes(role)}
                  onClick={() => set("escalationSteps", steps.map((x, j) => j === i ? { ...x, roles: x.roles.includes(role) ? x.roles.filter((y) => y !== role) : [...x.roles, role] } : x))}
                  className={cn("rounded-full border px-2.5 py-1 text-xs", s.roles.includes(role) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-ink-500")}>{ROLE_LABELS[role]}</button>
              ))}</div>
            </li>))}</ol>
          {steps.length < 4 && <Button type="button" size="sm" variant="secondary" onClick={() => set("escalationSteps", [...steps, { afterMinutes: (steps.at(-1)?.afterMinutes ?? 0) + 60, roles: ["household_owner"] }])}><Plus /> Add step</Button>}
          <p className="text-xs text-ink-500">Escalation stops as soon as the dose is recorded or someone taps “I'm on it”. If nobody holds a chosen role, the owner and administrators are notified instead.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Quiet hours</CardTitle><CardDescription>Escalations and non-urgent notices wait until morning. Dose-time reminders are still sent.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-3 text-sm"><Switch checked={r.quietHours.enabled} onCheckedChange={(v) => set("quietHours", { ...r.quietHours, enabled: v })} aria-label="Quiet hours" /> Enabled</label>
          <Field label="From"><Input type="time" value={r.quietHours.start} onChange={(e) => set("quietHours", { ...r.quietHours, start: e.target.value })} /></Field>
          <Field label="Until"><Input type="time" value={r.quietHours.end} onChange={(e) => set("quietHours", { ...r.quietHours, end: e.target.value })} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Appointments, tasks & handovers</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Appointment reminders (hours before, comma-separated)">
            <Input value={r.appointmentReminderHours.join(", ")} onChange={(e) => set("appointmentReminderHours", e.target.value.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0 && n <= 168).slice(0, 4))} />
          </Field>
          <Field label="Ask escorts to confirm (hours before)"><Input inputMode="numeric" value={r.escortConfirmHours} onChange={(e) => set("escortConfirmHours", Number(e.target.value) || 48)} /></Field>
          <Field label="Task due reminder (hours before)"><Input inputMode="numeric" value={r.taskDueReminderHours} onChange={(e) => set("taskDueReminderHours", Number(e.target.value) || 2)} /></Field>
          <Field label="Handover acknowledgement reminder (hours)"><Input inputMode="numeric" value={r.handoverReminderHours} onChange={(e) => set("handoverReminderHours", Number(e.target.value) || 12)} /></Field>
          <label className="flex items-center justify-between gap-4 text-sm sm:col-span-2"><span>Low medicine stock alerts</span><Switch checked={r.lowStockAlerts} onCheckedChange={(v) => set("lowStockAlerts", v)} aria-label="Low stock alerts" /></label>
        </CardContent>
      </Card>
      {editable && <div className="flex justify-end"><Button onClick={submit} loading={save.isPending}>Save rules</Button></div>}
    </fieldset>
  );
}

function DeliveryPrefsCard() {
  const p = useDeliveryPrefs();
  const save = useSaveDeliveryPrefs();
  if (p.isLoading) return <Skeleton className="h-40" />;
  if (p.isError) return <ErrorState error={p.error} />;
  const d = p.data!;
  const row = (key: "email" | "push", label: string, icon: typeof Mail, note: string) => {
    const I = icon;
    const configured = d.channels[key] === "configured";
    return (
      <label className="flex items-center justify-between gap-4 rounded-xl p-3 hover:bg-sage-50">
        <span className="flex items-start gap-3"><I className="mt-0.5 size-5 text-brand-600" aria-hidden /><span><span className="block text-sm font-medium">{label}</span>
          <span className="block text-xs text-ink-500">{configured ? note : "Not configured on this server yet — your choice is saved and will apply once it is."}</span></span></span>
        <Switch checked={d.prefs[key]} aria-label={label} onCheckedChange={(v) => save.mutate({ [key]: v }, { onSuccess: () => toast.success("Preference saved"), onError: (e) => toast.error(errorMessage(e)) })} />
      </label>
    );
  };
  return (
    <Card>
      <CardHeader><CardTitle>How you're notified</CardTitle><CardDescription>In-app notifications are always on. Messages never include medicine names or clinical details.</CardDescription></CardHeader>
      <CardContent className="-mx-3 space-y-1">
        {row("email", "Email", Mail, "Copies of reminders and alerts to your account email.")}
        {row("push", "Push notifications", Smartphone, `${d.devices} device(s) registered.`)}
      </CardContent>
    </Card>
  );
}

export function NotificationsPage() {
  const { householdId, membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Notifications" description="Reminders, escalations and alerts — with delivery and acknowledgement status." />
      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          {householdId && <TabsTrigger value="activity">Reminder activity</TabsTrigger>}
          {householdId && <TabsTrigger value="rules">Rules</TabsTrigger>}
          <TabsTrigger value="delivery">My delivery</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox"><Inbox /></TabsContent>
        {householdId && <TabsContent value="activity"><Activity hid={householdId} /></TabsContent>}
        {householdId && <TabsContent value="rules"><RulesEditor hid={householdId} /></TabsContent>}
        <TabsContent value="delivery"><DeliveryPrefsCard /></TabsContent>
      </Tabs>
    </>
  );
}
