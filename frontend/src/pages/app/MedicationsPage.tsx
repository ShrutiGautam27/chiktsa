import { useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { History, MoreHorizontal, Package, Pencil, Pill, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useAdherence, useMedStatus, useMeds, useRefill } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useMembers } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Medication } from "@/lib/care-types";
import type { Senior } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IssueList, JourneyDialog, MedicationFormDialog, VerifyDialog } from "@/features/care/MedicationDialogs";
import { MedStatusBadge, NeedsSenior, ProfilePicker } from "@/features/care/shared";
import { TodayDoses } from "@/features/care/TodayDoses";
export { TodayDoses };

function AdherenceCard({ hid, sid }: { hid: string; sid: string }) {
  const a = useAdherence(hid, sid, 7);
  return (
    <Card>
      <CardHeader><CardTitle>Last 7 days</CardTitle><CardDescription>{a.data?.note ?? "Recorded dose outcomes"}</CardDescription></CardHeader>
      <CardContent>
        {a.isLoading ? <Skeleton className="h-48" /> : a.isError ? <ErrorState error={a.error} /> : !a.data?.daily.length ? (
          <p className="text-sm text-ink-500">No scheduled doses in this period yet.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              <span><strong className="font-display text-xl">{a.data.totals.taken}</strong> recorded taken</span>
              <span><strong className="font-display text-xl">{a.data.totals.skipped}</strong> skipped</span>
              <span><strong className="font-display text-xl">{a.data.totals.unconfirmed}</strong> not recorded</span>
            </div>
            <div className="h-48" role="img" aria-label={`Dose records for the last 7 days: ${a.data.totals.taken} taken, ${a.data.totals.skipped} skipped, ${a.data.totals.unconfirmed} not recorded`}>
              <ResponsiveContainer>
                <BarChart data={a.data.daily.map((d) => ({ ...d, day: new Date(d.date + "T00:00").toLocaleDateString(undefined, { weekday: "short" }) }))}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-500)", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={24} tick={{ fill: "var(--color-ink-500)", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="taken" name="Taken" stackId="a" fill="var(--color-brand-500)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="skipped" name="Skipped" stackId="a" fill="var(--color-sage-400)" />
                  <Bar dataKey="unconfirmed" name="Not recorded" stackId="a" fill="var(--color-champagne-500)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RefillBar({ med }: { med: Medication }) {
  const r = med.refill;
  if (!r.tracked) return <p className="text-xs text-ink-500">Stock not tracked</p>;
  const pct = Math.min(100, Math.round(((r.daysRemaining ?? 0) / 30) * 100));
  const tone = r.level === "ok" ? "bg-brand-500" : r.level === "low" ? "bg-champagne-500" : "bg-danger-600";
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-500"><span>{r.stock} {med.doseUnit}(s) left</span><span>~{r.daysRemaining} days · until {r.depletionDate}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sage-100" role="progressbar" aria-valuenow={r.daysRemaining} aria-valuemin={0} aria-valuemax={30} aria-label="Days of stock remaining">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MedCard({ hid, sid, med, onEdit, onVerify, onJourney, onRefill }: {
  hid: string; sid: string; med: Medication; onEdit: () => void; onVerify: () => void; onJourney: () => void; onRefill: () => void;
}) {
  const { can } = useCareContext();
  const members = useMembers(hid);
  const status = useMedStatus(hid, sid);
  const [ending, setEnding] = useState(false);
  const responsible = members.data?.find((m) => m.uid === med.responsibleUid)?.displayName;
  const change = (s: "active" | "paused" | "ended") => status.mutate({ mid: med.id, status: s }, {
    onSuccess: () => { toast.success(s === "active" ? "Resumed" : s === "paused" ? "Paused" : "Ended"); setEnding(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className={cn("p-5", med.status === "pending_verification" && "border-warning-600/40")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Pill className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{med.name || <em className="text-warning-600">Name unclear</em>} <span className="font-normal text-ink-500">{med.strength}</span></h3>
            <MedStatusBadge status={med.status} />
            {med.source === "prescription" && <Badge tone="champagne">From prescription</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-ink-700">{med.doseQuantity ?? "?"} {med.doseUnit} at {med.times.join(", ") || "no times set"}{med.instructions ? ` · ${med.instructions}` : ""}</p>
          <p className="text-xs text-ink-500">Doses confirmed by: {responsible ?? <span className="text-warning-600">nobody assigned</span>}{med.verification ? ` · verified by ${med.verification.verifiedByName}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {med.status === "pending_verification" && can("meds.verify") && <Button size="sm" onClick={onVerify}><ShieldCheck /> Verify</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-lg p-2 hover:bg-sage-100" aria-label={`Actions for ${med.name}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={onJourney}><History /> Medication journey</DropdownMenuItem>
              {can("care.log.write") && med.status !== "ended" && <DropdownMenuItem onSelect={onRefill}><Package /> Record refill</DropdownMenuItem>}
              {can("senior.medical.write") && med.status !== "ended" && <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit</DropdownMenuItem>}
              {can("senior.medical.write") && med.status === "active" && <DropdownMenuItem onSelect={() => change("paused")}>Pause</DropdownMenuItem>}
              {can("senior.medical.write") && med.status === "paused" && <DropdownMenuItem onSelect={() => change("active")}>Resume</DropdownMenuItem>}
              {can("senior.medical.write") && med.status !== "ended" && <DropdownMenuItem className="text-danger-600" onSelect={() => setEnding(true)}>End medication</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {med.issues.length > 0 && <div className="mt-4"><IssueList med={med} /></div>}
      {med.status !== "pending_verification" && <div className="mt-4"><RefillBar med={med} /></div>}
      <ConfirmDialog open={ending} onOpenChange={setEnding} title={`End ${med.name}?`} description="Its schedule stops and it moves to history. Only do this when the prescriber has stopped it." confirmLabel="End medication" destructive loading={status.isPending} onConfirm={() => change("ended")} />
    </Card>
  );
}

function RefillDialog({ hid, sid, med, onClose }: { hid: string; sid: string; med: Medication | null; onClose: () => void }) {
  const refill = useRefill(hid, sid);
  const [qty, setQty] = useState("");
  if (!med) return null;
  const n = Number(qty);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Record refill — ${med.name}`} description="Adds to the recorded stock used for refill planning.">
      {med.refill.checklist && <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-700">{med.refill.checklist.map((c) => <li key={c}>{c}</li>)}</ul>}
      <Field label={`Quantity collected (${med.doseUnit}s)`} error={qty && !(n > 0) ? "Enter a positive number" : undefined}>
        <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!(n > 0)} loading={refill.isPending} onClick={() => refill.mutate({ mid: med.id, quantity: n }, {
          onSuccess: () => { toast.success("Stock updated"); onClose(); setQty(""); }, onError: (e) => toast.error(errorMessage(e)),
        })}>Save</Button>
      </div>
    </Dialog>
  );
}

function SeniorMeds({ hid, senior }: { hid: string; senior: Senior }) {
  const meds = useMeds(hid, senior.id);
  const { can } = useCareContext();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [verifying, setVerifying] = useState<Medication | null>(null);
  const [journey, setJourney] = useState<Medication | null>(null);
  const [refilling, setRefilling] = useState<Medication | null>(null);
  const live = (id?: string) => meds.data?.find((m) => m.id === id) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Today's doses — {senior.preferredName || senior.fullName}</CardTitle><CardDescription>Only verified, active medications are scheduled.</CardDescription></CardHeader>
          <CardContent><TodayDoses hid={hid} senior={senior} /></CardContent>
        </Card>
        <AdherenceCard hid={hid} sid={senior.id} />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl">Medications</h2>
          {can("senior.medical.write") && <Button onClick={() => setAdding(true)}><Plus /> Add medication</Button>}
        </div>
        {meds.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
          : meds.isError ? <ErrorState error={meds.error} onRetry={() => meds.refetch()} />
          : !meds.data?.length ? <EmptyState icon={Pill} title="No medications yet" description="Add medications from a verified prescription. They stay inactive until an authorised person verifies them." action={can("senior.medical.write") && <Button onClick={() => setAdding(true)}><Plus /> Add medication</Button>} />
          : <div className="space-y-3">{meds.data.map((m) => (
              <MedCard key={m.id} hid={hid} sid={senior.id} med={m} onEdit={() => setEditing(m)} onVerify={() => setVerifying(m)} onJourney={() => setJourney(m)} onRefill={() => setRefilling(m)} />
            ))}</div>}
      </section>

      <MedicationFormDialog open={adding} onOpenChange={setAdding} hid={hid} sid={senior.id} />
      <MedicationFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} hid={hid} sid={senior.id} med={editing ?? undefined} />
      <VerifyDialog hid={hid} sid={senior.id} med={live(verifying?.id)} onClose={() => setVerifying(null)} />
      <JourneyDialog hid={hid} sid={senior.id} med={journey} onClose={() => setJourney(null)} />
      <RefillDialog hid={hid} sid={senior.id} med={live(refilling?.id)} onClose={() => setRefilling(null)} />
    </div>
  );
}

export function MedicationsPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Medications" description="Schedules, dose records and adherence for each elderly profile — kept completely separate." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <SeniorMeds key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}
