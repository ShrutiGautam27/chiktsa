import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Activity, ArrowRight, CheckCircle2, FlaskConical, History, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useGaps, useHouseholdAppointments, useMeds, useSimulate } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useAudit, useMembers, useSeniors } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Gap } from "@/lib/care-types";
import { cn, relativeTime } from "@/lib/utils";
import { SeverityBadge, fmt, toLocalInput } from "@/features/care/shared";

export function GapList({ hid, sid, limit }: { hid: string; sid?: string; limit?: number }) {
  const gaps = useGaps(hid, sid);
  if (gaps.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (gaps.isError) return <ErrorState error={gaps.error} onRetry={() => gaps.refetch()} />;
  const list = (gaps.data?.gaps ?? []).slice(0, limit);
  if (!list.length) return <EmptyState icon={CheckCircle2} title="No care gaps found" description="Every upcoming responsibility has an owner. Chiktsa re-checks whenever care records change." />;
  return (
    <ul className="space-y-2">
      {list.map((g: Gap) => (
        <li key={g.id} className={cn("flex flex-wrap items-start gap-3 rounded-xl border p-4", g.severity === "high" ? "border-danger-600/30 bg-danger-50/50" : "border-line bg-surface")}>
          <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", g.severity === "high" ? "bg-danger-600" : g.severity === "medium" ? "bg-warning-600" : "bg-info-600")} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{g.title}</span><SeverityBadge severity={g.severity} />{g.seniorName && <Badge tone="neutral">{g.seniorName}</Badge>}</div>
            <p className="mt-0.5 text-sm text-ink-700">{g.detail}</p>
          </div>
          {g.link && <Button asChild size="sm" variant="secondary"><Link to={g.link}>{g.action || "Open"} <ArrowRight /></Link></Button>}
        </li>
      ))}
    </ul>
  );
}

function GapsTab({ hid }: { hid: string }) {
  const gaps = useGaps(hid);
  const c = gaps.data?.counts;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {c && (["high", "medium", "low"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm"><span className="font-display text-2xl">{c[s]}</span> <span className="text-ink-500">{s === "high" ? "need attention" : s === "medium" ? "soon" : "low"}</span></div>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => gaps.refetch()} loading={gaps.isFetching}><RefreshCw /> Re-check</Button>
      </div>
      <p className="text-xs text-ink-500">The gap detector looks at responsibilities — who is accompanying, confirming, covering or acknowledging. It never diagnoses or treats missing data as an emergency.</p>
      <GapList hid={hid} />
    </div>
  );
}

const TARGETS: [string, string][] = [["", "All changes"], ["medication", "Medications"], ["appointment", "Appointments"], ["task", "Tasks"], ["member", "Access & roles"], ["consent", "Consent"], ["senior", "Profiles"], ["handover", "Handovers"]];

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ") || "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ChangeDetective({ hid }: { hid: string }) {
  const seniors = useSeniors(hid);
  const members = useMembers(hid);
  const [sid, setSid] = useState("");
  const [target, setTarget] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const logs = useAudit(hid, sid || undefined);
  const list = useMemo(() => (logs.data ?? []).filter((l) =>
    (!target || l.targetType === target) && (!actor || l.actorUid === actor) && (!q || l.summary.toLowerCase().includes(q.toLowerCase()))), [logs.data, target, actor, q]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <NativeSelect aria-label="Profile" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">All profiles</option>{seniors.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</NativeSelect>
        <NativeSelect aria-label="Record type" value={target} onChange={(e) => setTarget(e.target.value)}>{TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
        <NativeSelect aria-label="Changed by" value={actor} onChange={(e) => setActor(e.target.value)}><option value="">Anyone</option>{members.data?.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}</NativeSelect>
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-300" aria-hidden /><Input aria-label="Search changes" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></div>
      </div>
      {logs.isLoading ? <Skeleton className="h-48" /> : logs.isError ? <ErrorState error={logs.error} /> : !list.length ? <EmptyState icon={History} title="No matching changes" description="Try a different filter." /> : (
        <Card><ul className="divide-y divide-line">
          {list.map((l) => (
            <li key={l.id} className="flex gap-3 p-4">
              <Avatar name={l.actorName} className="size-8 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><strong>{l.actorName}</strong> — {l.summary}</p>
                <p className="text-xs text-ink-500" title={fmt(l.at)}>{fmt(l.at)} · {relativeTime(l.at)} · <span className="uppercase tracking-wide">{l.targetType}</span></p>
                {l.changes && Object.keys(l.changes).length > 0 && (
                  <table className="mt-2 w-full max-w-xl text-xs">
                    <thead><tr className="text-left text-ink-500"><th className="pr-3 font-medium">Field</th><th className="pr-3 font-medium">Previous</th><th className="font-medium">Current</th></tr></thead>
                    <tbody>{Object.entries(l.changes).map(([k, c]) => (
                      <tr key={k} className="align-top"><td className="pr-3 text-ink-700">{k === "approvedBy" ? "Approved by" : k}</td><td className="pr-3 text-ink-500 line-through decoration-ink-300">{show(c.from)}</td><td className="text-ink-900">{show(c.to)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </li>
          ))}
        </ul></Card>
      )}
    </div>
  );
}

function MedPicker({ hid, sid, value, onChange }: { hid: string; sid: string; value: string; onChange: (v: string) => void }) {
  const meds = useMeds(hid, sid);
  return <NativeSelect aria-label="Medication" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose a medication</option>{meds.data?.filter((m) => m.status === "active").map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength}</option>)}</NativeSelect>;
}

function Simulator({ hid }: { hid: string }) {
  const sim = useSimulate(hid);
  const members = useMembers(hid);
  const seniors = useSeniors(hid);
  const appts = useHouseholdAppointments(hid, 60);
  const [scenario, setScenario] = useState("caregiver_unavailable");
  const [uid, setUid] = useState("");
  const [start, setStart] = useState(toLocalInput(new Date()));
  const [end, setEnd] = useState(toLocalInput(new Date(Date.now() + 2 * 86400000)));
  const [aid, setAid] = useState("");
  const [newStart, setNewStart] = useState(toLocalInput(new Date(Date.now() + 3 * 86400000)));
  const [sid, setSid] = useState("");
  const [mid, setMid] = useState("");
  const [stock, setStock] = useState("");
  const [hours, setHours] = useState("12");
  const run = () => {
    const iso = (s: string) => new Date(s).toISOString();
    const body: Record<string, unknown> = { scenario };
    if (scenario === "caregiver_unavailable") Object.assign(body, { uid, startsAt: iso(start), endsAt: iso(end) });
    if (scenario === "appointment_postponed") Object.assign(body, { appointmentId: aid, newStartsAt: iso(newStart) });
    if (scenario === "stock_depletion") Object.assign(body, { medicationId: mid, assumeStock: stock ? Number(stock) : null });
    if (scenario === "connectivity_failure") Object.assign(body, { hours: Number(hours), startsAt: new Date().toISOString() });
    sim.mutate(body, { onError: (e) => toast.error(errorMessage(e)) });
  };
  const r = sim.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <Card>
        <CardHeader><CardTitle>Scenario</CardTitle><CardDescription>Explore “what if” without changing anything.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <NativeSelect aria-label="Scenario" value={scenario} onChange={(e) => { setScenario(e.target.value); sim.reset(); }}>
            <option value="caregiver_unavailable">A caregiver is unavailable</option>
            <option value="appointment_postponed">An appointment is postponed</option>
            <option value="stock_depletion">Medicine stock runs out</option>
            <option value="connectivity_failure">Internet goes down</option>
          </NativeSelect>
          {scenario === "caregiver_unavailable" && <>
            <Field label="Who"><NativeSelect value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Choose a member</option>{members.data?.filter((m) => m.role !== "senior").map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}</NativeSelect></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="From"><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Until"><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
          </>}
          {scenario === "appointment_postponed" && <>
            <Field label="Appointment"><NativeSelect value={aid} onChange={(e) => setAid(e.target.value)}><option value="">Choose an appointment</option>{appts.data?.map((a) => <option key={a.id} value={a.id}>{a.title} — {a.seniorName} ({fmt(a.startsAt, undefined, { dateStyle: "short" })})</option>)}</NativeSelect></Field>
            <Field label="New time"><Input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></Field>
          </>}
          {scenario === "stock_depletion" && <>
            <Field label="Profile"><NativeSelect value={sid} onChange={(e) => { setSid(e.target.value); setMid(""); }}><option value="">Choose a profile</option>{seniors.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</NativeSelect></Field>
            {sid && <Field label="Medication"><MedPicker hid={hid} sid={sid} value={mid} onChange={setMid} /></Field>}
            <Field label="Assume stock of (optional)" hint="Leave empty to use the recorded stock"><Input inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
          </>}
          {scenario === "connectivity_failure" && <Field label="Offline for (hours)"><Input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>}
          <Button className="w-full" onClick={run} loading={sim.isPending}><FlaskConical /> Run simulation</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Impact</CardTitle>{r && <CardDescription>{r.disclaimer}</CardDescription>}</CardHeader>
        <CardContent>
          {!r ? <p className="text-sm text-ink-500">Choose a scenario and run it to see which responsibilities would be affected.</p> : (
            <div className="space-y-4 text-sm">
              <p className="rounded-xl bg-brand-50 p-3 font-medium text-brand-800">{r.summary}</p>
              {r.affectedResponsibilities?.length > 0 && <div><h4 className="mb-1 font-semibold">Responsibilities affected</h4><ul className="space-y-1">{r.affectedResponsibilities.map((i: any) => (
                <li key={i.id} className="rounded-lg border border-line p-2">{i.title} — backups: {i.backups.length ? i.backups.map((b: any) => b.displayName).join(", ") : <span className="text-danger-600">none available</span>}</li>))}</ul></div>}
              {r.doseConfirmationDuties?.length > 0 && <div><h4 className="mb-1 font-semibold">Dose confirmations</h4><ul className="space-y-1">{r.doseConfirmationDuties.map((d: any) => (
                <li key={d.medicationId} className="rounded-lg border border-line p-2">{d.seniorName}: {d.name} — {d.dosesToConfirm} dose(s) need someone to record them</li>))}</ul></div>}
              {r.effects?.length > 0 && <ul className="space-y-1">{r.effects.map((e: any, i: number) => <li key={i} className="rounded-lg border border-line p-2">{e.detail}</li>)}</ul>}
              {r.refill && <p>Order by <strong>{r.orderBy}</strong>. {r.appointmentsBeforeDepletion?.length ? `Upcoming visits before then: ${r.appointmentsBeforeDepletion.map((a: any) => a.title).join(", ")} — a chance to ask for a new prescription.` : ""}</p>}
              {r.dosesToRecordLater && <>
                <p>{r.dosesToRecordLater.length} dose(s) and {r.tasksDue.length} task(s) would need recording once back online.</p>
                <ul className="list-disc pl-5 text-ink-700">{r.recommendations.map((x: string) => <li key={x}>{x}</li>)}</ul>
                <p className="text-xs text-ink-500">{r.limitations}</p>
              </>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ContinuityPage() {
  const { householdId, membership, can } = useCareContext();
  if (!householdId) return <EmptyState icon={Activity} title="No household selected" description="Create or join a household first." />;
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Care Continuity" description="Find responsibilities nobody has picked up, see exactly what changed, and plan for disruptions." />
      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">Care gaps</TabsTrigger>
          {can("audit.read") && <TabsTrigger value="changes">Change Detective</TabsTrigger>}
          {can("tasks.manage") && <TabsTrigger value="sim">What-If Simulator</TabsTrigger>}
        </TabsList>
        <TabsContent value="gaps"><GapsTab hid={householdId} /></TabsContent>
        {can("audit.read") && <TabsContent value="changes"><ChangeDetective hid={householdId} /></TabsContent>}
        {can("tasks.manage") && <TabsContent value="sim"><Simulator hid={householdId} /></TabsContent>}
      </Tabs>
    </>
  );
}
