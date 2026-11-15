import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Home, Scale, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useContribution, useOverview, useTaskAction } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { errorMessage } from "@/lib/api";
import { ROLE_LABELS, type Role } from "@/lib/types";

function Workload({ hid }: { hid: string }) {
  const c = useContribution(hid);
  const act = useTaskAction();
  if (c.isLoading) return <Skeleton className="h-72" />;
  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  const d = c.data!;
  const chart = d.members.filter((m) => m.canTakeTasks).map((m) => ({ name: m.displayName.split(" ")[0], Accepted: m.accepted, "Awaiting acceptance": m.assignedPending, Accompanying: m.escortUpcoming }));
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-sage-50 p-3 text-sm text-ink-700"><Scale className="mr-1.5 inline size-4 text-brand-600" />{d.principle}</p>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Current responsibilities</CardTitle><CardDescription>Average load {d.averageLoad} · {d.unassignedTasks} unassigned</CardDescription></CardHeader>
          <CardContent>
            {chart.length === 0 ? <p className="text-sm text-ink-500">No one can take tasks yet.</p> : (
              <div className="h-64" role="img" aria-label="Current responsibilities per member">
                <ResponsiveContainer>
                  <BarChart data={chart}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-500)", fontSize: 12 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} tick={{ fill: "var(--color-ink-500)", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 12 }} labelStyle={{ color: "var(--color-ink-900)" }} itemStyle={{ color: "var(--color-ink-900)" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Accepted" stackId="a" fill="var(--color-brand-500)" />
                    <Bar dataKey="Awaiting acceptance" stackId="a" fill="var(--color-sage-400)" />
                    <Bar dataKey="Accompanying" stackId="a" fill="var(--color-champagne-500)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Workload balancer</CardTitle><CardDescription>Suggestions to share work more evenly. Nothing changes until you apply one.</CardDescription></CardHeader>
          <CardContent>
            {!d.fullView ? <p className="text-sm text-ink-500">Coordinators see suggestions for the whole household.</p>
              : !d.suggestions.length ? <p className="text-sm text-ink-500">Workload looks balanced right now.</p> : (
                <ul className="space-y-2">{d.suggestions.map((s) => (
                  <li key={s.taskId} className="rounded-xl border border-line p-3 text-sm">
                    <p className="font-medium">{s.taskTitle}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-ink-700">{s.fromName} <ArrowRight className="size-3.5" /> {s.toName}</p>
                    <p className="text-xs text-ink-500">{s.reason}</p>
                    <Button size="sm" variant="secondary" className="mt-2" loading={act.isPending && act.variables?.tid === s.taskId}
                      onClick={() => act.mutate({ hid, tid: s.taskId, action: "reassign", body: { assigneeUid: s.toUid } }, {
                        onSuccess: () => toast.success(`Reassigned to ${s.toName} — they'll be asked to accept`), onError: (e) => toast.error(errorMessage(e)),
                      })}>Apply suggestion</Button>
                  </li>))}</ul>
              )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Care contributions — last {d.windowDays} days</CardTitle><CardDescription>Listed alphabetically.</CardDescription></CardHeader>
        <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-600" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-y border-line text-left text-xs uppercase tracking-wide text-ink-500">
              {["Member", "Accepted", "Awaiting", "Overdue", "Completed", "Accompanying", "Doses recorded", "Handovers"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{d.members.map((m) => (
              <tr key={m.uid} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><span className="font-medium">{m.displayName}</span><span className="block text-xs text-ink-500">{ROLE_LABELS[m.role as Role]}{m.unavailableNow ? " · unavailable" : ""}</span>
                  {m.imbalanced && <Badge tone="warning" className="mt-1">Heavy load</Badge>}</td>
                <td className="px-4 py-3">{m.accepted}</td><td className="px-4 py-3">{m.assignedPending}</td>
                <td className="px-4 py-3">{m.overdue ? <span className="text-danger-600">{m.overdue}</span> : 0}</td>
                <td className="px-4 py-3">{m.completed}</td><td className="px-4 py-3">{m.escortUpcoming}</td>
                <td className="px-4 py-3">{m.dosesRecorded}</td><td className="px-4 py-3">{m.handoversWritten}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Overview() {
  const o = useOverview();
  const { setHousehold } = useCareContext();
  if (o.isLoading) return <Skeleton className="h-32" />;
  if (o.isError) return <ErrorState error={o.error} />;
  if (!o.data?.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>All your households</CardTitle><CardDescription>A consolidated view — medical details stay inside each household.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {o.data.map((h) => (
          <button key={h.householdId} onClick={() => setHousehold(h.householdId)} className="rounded-2xl border border-line p-4 text-left transition-colors hover:bg-sage-50">
            <div className="flex items-center gap-2 font-medium"><Home className="size-4 text-brand-600" />{h.householdName}</div>
            <p className="text-xs text-ink-500">{ROLE_LABELS[h.role as Role]} · {h.profiles} profile(s)</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div><div className="font-display text-xl">{h.myOpenTasks}</div>my tasks</div>
              <div><div className="font-display text-xl">{h.appointmentsNext7Days}</div>visits 7d</div>
              <div><div className={`font-display text-xl ${h.gaps?.high ? "text-danger-600" : ""}`}>{h.gaps ? h.gaps.high + h.gaps.medium : "—"}</div>gaps</div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function CoordinationPage() {
  const { householdId, membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Family Coordination" description="See how care is shared, spot workload imbalance early, and keep every household in view." />
      <div className="space-y-6">
        <Overview />
        {householdId ? <Workload hid={householdId} /> : <EmptyState icon={Users} title="No household selected" description="Create or join a household first." />}
      </div>
    </>
  );
}
