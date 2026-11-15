import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Building2, Download, KeyRound, Mic, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, StatCard } from "@/components/common";
import { downloadBlob, useOrgAction, useOrgDashboard, useOrgs, useReport, type Org } from "@/hooks/wellbeing-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useSeniors } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { NeedsSenior, ProfilePicker } from "@/features/care/shared";
import { ScopePicker } from "@/features/ScopePicker";
import { VoiceCompanion } from "@/features/wellbeing/components";
import type { SeniorScope } from "@/lib/types";

const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--color-ink-500)", fontSize: 11 } } as const;
const tip = { contentStyle: { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 12 }, labelStyle: { color: "var(--color-ink-900)" }, itemStyle: { color: "var(--color-ink-900)" } };

// ------------------------------------------------------------------ Reports
export function ReportsPage() {
  const { householdId, membership } = useCareContext();
  const [days, setDays] = useState(30);
  const r = useReport(householdId ?? undefined, days);
  const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Reports & analytics" description="How well care was recorded and covered — coordination, not health outcomes."
        actions={<>
          <NativeSelect value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="w-36">{[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</NativeSelect>
          {householdId && <Button variant="outline" onClick={() => downloadBlob(`/households/${householdId}/reports.csv?days=${days}`, "carehub-report.csv").catch((e) => toast.error(errorMessage(e)))}><Download /> CSV</Button>}
        </>} />
      {r.isLoading ? <Skeleton className="h-96" /> : r.isError ? (r.error instanceof ApiError && r.error.status === 403
        ? <EmptyState icon={BarChart3} title="Reports are for administrators" description="Household owners, family administrators and organisation administrators can see reports." />
        : <ErrorState error={r.error} />) : r.data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tasks completed" value={r.data.tasks.completed} icon={BarChart3} hint={`${r.data.tasks.created} created · ${pct(r.data.tasks.onTimeRate)} on time`} />
            <StatCard label="Median time to complete" value={r.data.tasks.medianHoursToComplete != null ? `${r.data.tasks.medianHoursToComplete} h` : "—"} icon={BarChart3} tone="sage" />
            <StatCard label="Dose reminders" value={r.data.reminders.sent} icon={BarChart3} tone="champagne" hint={`${r.data.reminders.escalated} escalated · ${r.data.reminders.acknowledged} acknowledged`} />
            <StatCard label="Median minutes to record a dose" value={r.data.reminders.medianMinutesToRecord ?? "—"} icon={BarChart3} hint="After its scheduled time" />
          </div>
          {r.data.seniors.map((s) => (
            <Card key={s.seniorId}>
              <CardHeader><CardTitle>{s.name}</CardTitle><CardDescription>
                {s.adherence ? `${s.adherence.taken} recorded taken · ${s.adherence.skipped} skipped · ${s.adherence.unconfirmed} not recorded · ${pct(s.adherence.recordedRate)} of doses have a record` : "Medications not shared with you"}
                {s.wellness && s.wellness.checkins > 0 && ` · ${s.wellness.checkins} check-ins, average mood ${s.wellness.averageMood}/5`}</CardDescription></CardHeader>
              {s.adherence && s.adherence.weekly.length > 0 && <CardContent><div className="h-56" role="img" aria-label={`Weekly dose records for ${s.name}`}>
                <ResponsiveContainer><BarChart data={s.adherence.weekly.map((w) => ({ ...w, week: w.week.slice(5) }))}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" /><XAxis dataKey="week" {...axis} /><YAxis allowDecimals={false} width={28} {...axis} /><Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="taken" name="Taken" stackId="a" fill="var(--color-brand-500)" /><Bar dataKey="skipped" name="Skipped" stackId="a" fill="var(--color-sage-400)" />
                  <Bar dataKey="unconfirmed" name="Not recorded" stackId="a" fill="var(--color-champagne-500)" radius={[6, 6, 0, 0]} />
                </BarChart></ResponsiveContainer></div></CardContent>}
            </Card>
          ))}
          {r.data.tasks.weekly.length > 0 && <Card><CardHeader><CardTitle>Tasks per week</CardTitle></CardHeader><CardContent><div className="h-56" role="img" aria-label="Tasks created and completed per week">
            <ResponsiveContainer><BarChart data={r.data.tasks.weekly.map((w) => ({ ...w, week: w.week.slice(5) }))}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" /><XAxis dataKey="week" {...axis} /><YAxis allowDecimals={false} width={28} {...axis} /><Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="created" name="Created" fill="var(--color-sage-400)" radius={[6, 6, 0, 0]} /><Bar dataKey="completed" name="Completed" fill="var(--color-brand-500)" radius={[6, 6, 0, 0]} />
            </BarChart></ResponsiveContainer></div></CardContent></Card>}
          <p className="text-xs text-ink-500">{r.data.note}</p>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Organisation
function AssignForm({ org }: { org: Org }) {
  const act = useOrgAction();
  const [hid, setHid] = useState(org.households[0]?.householdId ?? "");
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("secondary_caregiver");
  const [scope, setScope] = useState<SeniorScope>("all");
  const seniors = useSeniors(hid || undefined);
  if (!org.households.length) return <p className="text-sm text-ink-500">Connect a client household first (share your code with the family).</p>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Client household"><NativeSelect value={hid} onChange={(e) => { setHid(e.target.value); setScope("all"); }}>{org.households.map((h) => <option key={h.householdId} value={h.householdId}>{h.householdName}</option>)}</NativeSelect></Field>
        <Field label="Caregiver"><NativeSelect value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Choose staff</option>{org.staff.filter((s) => s.role === "org_caregiver").map((s) => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}</NativeSelect></Field>
        <Field label="Role"><NativeSelect value={role} onChange={(e) => setRole(e.target.value)}><option value="primary_caregiver">Primary caregiver</option><option value="secondary_caregiver">Secondary caregiver</option></NativeSelect></Field>
      </div>
      <ScopePicker seniors={seniors.data ?? []} value={scope} onChange={setScope} />
      <Button disabled={!uid || !hid || (scope !== "all" && !scope.length)} loading={act.isPending}
        onClick={() => act.mutate({ action: "assign", oid: org.id, householdId: hid, uid, role, seniorScope: scope }, { onSuccess: () => toast.success("Caregiver assigned"), onError: (e) => toast.error(errorMessage(e)) })}>Assign</Button>
    </div>
  );
}

function OrgView({ org }: { org: Org }) {
  const act = useOrgAction();
  const dash = useOrgDashboard(org.id, org.myRole === "org_admin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string | null>(org.connectCode ?? null);
  if (org.myRole !== "org_admin") return <Card className="p-5 text-sm">You're a caregiver at <strong>{org.name}</strong>. Your client households appear in the household switcher.</Card>;
  return (
    <div className="space-y-6">
      {dash.data && <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Client households" value={dash.data.totals.households} icon={Building2} />
        <StatCard label="Elderly profiles" value={dash.data.totals.profiles} icon={Building2} tone="champagne" />
        <StatCard label="Care gaps needing attention" value={dash.data.totals.highGaps} icon={Building2} tone="sage" />
        <StatCard label="Open tasks" value={dash.data.totals.openTasks} icon={Building2} />
      </div>}
      <Card><CardHeader><CardTitle>Client households</CardTitle></CardHeader>
        {dash.isLoading ? <CardContent><Skeleton className="h-24" /></CardContent> : !dash.data?.households.length ? <CardContent className="text-sm text-ink-500">No connected households yet.</CardContent> : (
          <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand-600" tabIndex={0} role="region" aria-label="Scrollable table"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-y border-line text-left text-xs uppercase text-ink-500">{["Household", "Profiles", "Open tasks", "Unassigned", "Gaps"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{dash.data.households.map((h) => <tr key={h.householdId} className="border-b border-line last:border-0"><td className="px-4 py-3 font-medium">{h.householdName}</td><td className="px-4 py-3">{h.profiles}</td><td className="px-4 py-3">{h.openTasks}</td><td className="px-4 py-3">{h.unassignedTasks}</td>
              <td className="px-4 py-3">{h.gaps.high > 0 ? <Badge tone="danger">{h.gaps.high} urgent</Badge> : <Badge tone="brand">{h.gaps.medium + h.gaps.low} minor</Badge>}</td></tr>)}</tbody></table></div>)}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Staff workload</CardTitle><CardDescription>Across every client household.</CardDescription></CardHeader><CardContent>
          {!dash.data?.staff.length ? <p className="text-sm text-ink-500">No staff placed in households yet.</p> : <ul className="space-y-2 text-sm">{dash.data.staff.map((s) => (
            <li key={s.uid} className="flex items-center justify-between rounded-xl bg-sage-50 px-3 py-2"><span className="font-medium">{s.displayName}</span><span className="text-ink-500">{s.households} household(s) · {s.currentLoad} active · {s.completed30d} done (30d)</span></li>))}</ul>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Team & connection code</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm"><KeyRound className="size-4 text-brand-600" />
            {code ? <>Share this code with a family: <strong className="font-mono text-lg tracking-widest">{code}</strong></> : "The connection code is hidden — generate a new one to share."}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => act.mutate({ action: "code", oid: org.id }, { onSuccess: (r) => setCode((r as { connectCode: string }).connectCode) })}>New code</Button></div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ action: "staff", oid: org.id, email, role: "org_caregiver" }, { onSuccess: () => { toast.success("Staff added"); setEmail(""); }, onError: (er) => toast.error(errorMessage(er)) }); }}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="caregiver@agency.com" aria-label="Staff email" />
            <Button type="submit" disabled={!email.includes("@")}><UserPlus /> Add</Button>
          </form>
          <ul className="text-sm text-ink-700">{org.staff.map((s) => <li key={s.uid}>{s.displayName} · <span className="text-ink-500">{s.role === "org_admin" ? "Administrator" : "Caregiver"}</span></li>)}</ul>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Place a caregiver</CardTitle><CardDescription>Choose exactly which elderly profiles they look after.</CardDescription></CardHeader><CardContent><AssignForm org={org} /></CardContent></Card>
    </div>
  );
}

export function OrganisationPage() {
  const orgs = useOrgs();
  const act = useOrgAction();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const current = orgs.data?.find((o) => o.id === sel) ?? orgs.data?.[0];
  return (
    <>
      <PageHeader title="Organisation" description="For professional care agencies serving many households."
        actions={orgs.data && orgs.data.length > 1 ? <NativeSelect value={current?.id} onChange={(e) => setSel(e.target.value)} aria-label="Organisation">{orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect> : null} />
      {orgs.isLoading ? <Skeleton className="h-64" /> : orgs.isError ? <ErrorState error={orgs.error} /> : current ? <OrgView key={current.id} org={act.data && (act.data as Org).id === current.id ? { ...current, ...(act.data as Org) } : current} /> : (
        <EmptyState icon={Building2} title="Set up your care organisation" description="Create an organisation, add your caregivers, and connect client households with a code."
          action={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act.mutate({ action: "create", name }, { onSuccess: () => toast.success("Organisation created"), onError: (er) => toast.error(errorMessage(er)) }); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organisation name" aria-label="Organisation name" /><Button type="submit" disabled={name.trim().length < 2} loading={act.isPending}>Create</Button></form>} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ Voice
export function VoicePage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Voice Companion" description="Ask by voice in English or Hindi — medicines, appointments, calling family, or the emergency card." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => (
        <Card key={senior.id}><CardContent className="p-6"><VoiceCompanion hid={hid} sid={senior.id} /></CardContent></Card>
      )}</NeedsSenior>
      <p className="mt-4 flex items-center gap-2 text-xs text-ink-500"><Mic className="size-3.5" /> Speech is processed by your browser. Anything that changes a record asks you to confirm first.</p>
    </>
  );
}
