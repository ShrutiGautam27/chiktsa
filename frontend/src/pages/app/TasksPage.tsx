import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRightLeft, CalendarCheck, CheckCircle2, ClipboardList, HandHelping, LifeBuoy, MoreHorizontal, Plus, Wand2 } from "lucide-react";
import { TaskConverterDialog } from "@/features/ai/components";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useAppointmentAction, useCover, useCreateTask, useResponsibilities, useTaskAction, useTasks } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe, useSeniors } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import { enqueue, isOfflineError } from "@/lib/offline";
import type { CareTask } from "@/lib/care-types";
import { cn } from "@/lib/utils";
import { DualTime, MemberSelect, TaskStatusBadge } from "@/features/care/shared";

const KINDS: [string, string][] = [["general", "General"], ["medication_check", "Medication check"], ["appointment_escort", "Appointment support"], ["errand", "Errand"], ["follow_up", "Follow-up"], ["household", "Household"]];

function TaskDialog({ hid, open, onOpenChange }: { hid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateTask(hid);
  const seniors = useSeniors(hid);
  const [v, setV] = useState({ title: "", description: "", seniorId: "", kind: "general", priority: "normal", dueAt: "", assigneeUid: "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return setErr("Give the task a title");
    try {
      await create.mutateAsync({ title: v.title.trim(), description: v.description, seniorId: v.seniorId || null, kind: v.kind, priority: v.priority,
        dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null, assigneeUid: v.assigneeUid || null });
      toast.success(v.assigneeUid ? "Task assigned — they'll be asked to accept" : "Task created");
      onOpenChange(false);
      setV({ title: "", description: "", seniorId: "", kind: "general", priority: "normal", dueAt: "", assigneeUid: "" });
    } catch (e2) {
      toast.error(errorMessage(e2));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New care task" description="Assign it now, or leave it open for someone to claim.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Title" error={err}><Input value={v.title} onChange={(e) => { set("title", e.target.value); setErr(""); }} autoFocus /></Field>
        <Field label="Details"><Textarea rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For">
            <NativeSelect value={v.seniorId} onChange={(e) => { set("seniorId", e.target.value); set("assigneeUid", ""); }}>
              <option value="">The whole household</option>
              {seniors.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Type"><NativeSelect value={v.kind} onChange={(e) => set("kind", e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          <Field label="Due (optional)"><Input type="datetime-local" value={v.dueAt} onChange={(e) => set("dueAt", e.target.value)} /></Field>
          <Field label="Priority"><NativeSelect value={v.priority} onChange={(e) => set("priority", e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></NativeSelect></Field>
        </div>
        <Field label="Assign to"><MemberSelect hid={hid} seniorId={v.seniorId || null} value={v.assigneeUid} onChange={(x) => set("assigneeUid", x)} placeholder="Leave unassigned" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create task</Button></div>
      </form>
    </Dialog>
  );
}

export function TaskRow({ task, showHousehold }: { task: CareTask; showHousehold?: boolean }) {
  const me = useMe();
  const { can, householdId } = useCareContext();
  const act = useTaskAction();
  const [reassign, setReassign] = useState(false);
  const [to, setTo] = useState("");
  const mine = task.assigneeUid === me.data?.user.uid;
  const manage = can("tasks.manage") && task.householdId === householdId;
  const run = (action: "accept" | "decline" | "claim" | "complete" | "cancel" | "reassign", body?: unknown, msg = "Updated") =>
    act.mutate({ hid: task.householdId, tid: task.id, action, body }, {
      onSuccess: () => toast.success(msg),
      onError: (e) => {
        if (action === "complete" && isOfflineError(e)) {
          enqueue({ type: "task.complete", householdId: task.householdId, seniorId: null, label: task.title, payload: { taskId: task.id, note: "" } });
          return toast.info("You're offline — completion saved on this device and will sync.");
        }
        toast.error(errorMessage(e));
      },
    });
  const open = ["open", "assigned", "accepted"].includes(task.status);
  return (
    <li className={cn("flex flex-wrap items-center gap-3 p-4", task.overdue && "bg-danger-50/40")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", task.status === "done" && "text-ink-500 line-through")}>{task.title}</span>
          <TaskStatusBadge status={task.status} />
          {task.priority === "high" && <Badge tone="danger">High priority</Badge>}
          {task.overdue && <Badge tone="danger">Overdue</Badge>}
          {task.coverNeeded && <Badge tone="warning">Cover needed</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {[showHousehold && task.householdName, task.seniorName ?? "Household", task.assigneeName ? `Owner: ${task.assigneeName}` : "No owner",
            task.status === "done" && task.completedByName ? `done by ${task.completedByName}` : null].filter(Boolean).join(" · ")}
          {task.dueAt && <> · due <DualTime iso={task.dueAt} /></>}
        </p>
        {task.description && <p className="mt-1 text-sm text-ink-700">{task.description}</p>}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {mine && task.status === "assigned" && <Button size="sm" onClick={() => run("accept", undefined, "Accepted")}>Accept</Button>}
          {task.status === "open" && can("tasks.update_assigned") && <Button size="sm" variant="secondary" onClick={() => run("claim", undefined, "It's yours")}><HandHelping /> I'll do it</Button>}
          {(mine && task.status === "accepted") && <Button size="sm" variant="outline" onClick={() => run("complete", { note: "" }, "Marked done")}><CheckCircle2 /> Done</Button>}
          {(mine || manage) && (
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-lg p-2 hover:bg-sage-100" aria-label={`Actions for ${task.title}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent>
                {mine && <DropdownMenuItem onSelect={() => run("decline", undefined, "Returned to the team")}>I can't do this</DropdownMenuItem>}
                {manage && !mine && <DropdownMenuItem onSelect={() => run("complete", { note: "" }, "Marked done")}>Mark done</DropdownMenuItem>}
                {manage && <DropdownMenuItem onSelect={() => setReassign(true)}>Reassign</DropdownMenuItem>}
                {manage && <DropdownMenuItem className="text-danger-600" onSelect={() => run("cancel", undefined, "Task cancelled")}>Cancel task</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {reassign && (
        <Dialog open onOpenChange={(o) => !o && setReassign(false)} title="Reassign task" description={task.title}>
          <Field label="New owner"><MemberSelect hid={task.householdId} seniorId={task.seniorId} value={to} onChange={setTo} placeholder="Choose a member" /></Field>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReassign(false)}>Cancel</Button>
            <Button disabled={!to} loading={act.isPending} onClick={() => { run("reassign", { assigneeUid: to }, "Reassigned"); setReassign(false); }}>Reassign</Button>
          </div>
        </Dialog>
      )}
    </li>
  );
}

function MyResponsibilities() {
  const r = useResponsibilities();
  const cover = useCover();
  const appt = useAppointmentAction("");
  if (r.isLoading) return <Skeleton className="h-64" />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!;
  const nothing = !d.myTasks.length && !d.coverRequests.length && !d.escorts.length && !d.handoversToAcknowledge.length && !d.claimable.length;
  if (nothing) return <EmptyState icon={CheckCircle2} title="You're all caught up" description="Nothing is waiting on you across your households." />;
  return (
    <div className="space-y-6">
      {d.coverRequests.length > 0 && (
        <Card className="border-warning-600/40">
          <CardHeader><CardTitle className="flex items-center gap-2"><LifeBuoy className="size-4 text-warning-600" /> Cover requests</CardTitle><CardDescription>Someone is unavailable and you're an authorised backup.</CardDescription></CardHeader>
          <CardContent><ul className="space-y-2">{d.coverRequests.map((c) => (
            <li key={c.absenceId + c.itemId} className="flex flex-wrap items-center gap-3 rounded-xl bg-warning-50 p-3 text-sm">
              <span className="flex-1"><strong>{c.title}</strong> · {c.householdName} · {c.absentName} is away{c.dueAt && <> · <DualTime iso={c.dueAt} /></>}</span>
              <Button size="sm" loading={cover.isPending} onClick={() => cover.mutate({ hid: c.householdId, absenceId: c.absenceId, itemType: c.itemType, itemId: c.itemId }, {
                onSuccess: () => toast.success("Thank you — you're covering this"), onError: (e) => toast.error(errorMessage(e)),
              })}>I'll cover it</Button>
            </li>))}</ul></CardContent>
        </Card>
      )}
      {d.handoversToAcknowledge.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ArrowRightLeft className="size-4 text-brand-600" /> Handovers to review</CardTitle></CardHeader>
          <CardContent><ul className="space-y-2">{d.handoversToAcknowledge.map((h) => (
            <li key={h.id} className="flex items-center gap-3 text-sm"><span className="flex-1">From <strong>{h.fromName}</strong> · {h.householdName}</span><Button asChild size="sm" variant="secondary"><Link to="/app/handover">Review</Link></Button></li>
          ))}</ul></CardContent>
        </Card>
      )}
      {d.myTasks.length > 0 && (
        <Card><CardHeader><CardTitle>My tasks</CardTitle></CardHeader>
          <ul className="divide-y divide-line border-t border-line">{d.myTasks.map((t) => <TaskRow key={t.id} task={t} showHousehold />)}</ul></Card>
      )}
      {d.escorts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarCheck className="size-4 text-brand-600" /> Appointments to accompany</CardTitle></CardHeader>
          <CardContent><ul className="space-y-2">{d.escorts.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
              <span className="flex-1"><strong>{e.title}</strong> · {e.seniorName} · {e.householdName} · <DualTime iso={e.startsAt} /></span>
              {e.mine && !e.escortAccepted && <Button size="sm" onClick={() => appt.mutate({ hid: e.householdId, sid: e.seniorId, aid: e.id, action: "escort", body: { action: "accept" } }, {
                onSuccess: () => toast.success("Confirmed"), onError: (er) => toast.error(errorMessage(er)) })}>Confirm</Button>}
              {e.mine && e.escortAccepted && <Badge tone="brand">Confirmed</Badge>}
              {!e.mine && <Badge tone="warning">Needs someone</Badge>}
            </li>))}</ul></CardContent>
        </Card>
      )}
      {d.claimable.length > 0 && (
        <Card><CardHeader><CardTitle>Unassigned — can you help?</CardTitle></CardHeader>
          <ul className="divide-y divide-line border-t border-line">{d.claimable.map((t) => <TaskRow key={t.id} task={t} showHousehold />)}</ul></Card>
      )}
    </div>
  );
}

function HouseholdBoard({ hid }: { hid: string }) {
  const tasks = useTasks(hid);
  const { can } = useCareContext();
  const [open, setOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const list = (tasks.data ?? []).filter((t) => filter === "all" || (filter === "open" ? ["open", "assigned", "accepted"].includes(t.status) : t.status === "done"));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter" className="inline-flex rounded-xl bg-sage-100 p-1">
          {(["open", "done", "all"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-lg px-3 py-1.5 text-sm", filter === f ? "bg-surface font-medium shadow-soft" : "text-ink-500")}>{f === "open" ? "Open" : f === "done" ? "Done" : "All"}</button>
          ))}
        </div>
        {can("tasks.manage") && <Button className="ml-auto" variant="secondary" onClick={() => setConverting(true)}><Wand2 /> In my own words</Button>}
        {can("tasks.manage") && <Button onClick={() => setOpen(true)}><Plus /> New task</Button>}
      </div>
      {tasks.isLoading ? <Skeleton className="h-48" /> : tasks.isError ? <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
        : !list.length ? <EmptyState icon={ClipboardList} title="No tasks here" description="Create tasks for appointments, refills, errands and follow-ups." />
        : <Card><ul className="divide-y divide-line">{list.map((t) => <TaskRow key={t.id} task={t} />)}</ul></Card>}
      <TaskDialog hid={hid} open={open} onOpenChange={setOpen} />
      {converting && <TaskConverterDialog hid={hid} open={converting} onOpenChange={setConverting} />}
    </>
  );
}

export function TasksPage() {
  const { householdId, membership } = useCareContext();
  return (
    <>
      <PageHeader title="Responsibility Centre" description="Everything that needs an owner — across all your households — without exposing medical details you aren't authorised to see." />
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">Waiting on me</TabsTrigger>
          {householdId && <TabsTrigger value="board">{membership?.householdName} task board</TabsTrigger>}
        </TabsList>
        <TabsContent value="mine"><MyResponsibilities /></TabsContent>
        {householdId && <TabsContent value="board"><HouseholdBoard hid={householdId} /></TabsContent>}
      </Tabs>
    </>
  );
}
