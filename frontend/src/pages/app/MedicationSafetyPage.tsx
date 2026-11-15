import { useState } from "react";
import { AlertOctagon, CheckCircle2, Info, PackageX, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { ErrorState, PageHeader } from "@/components/common";
import { useMedReview, useMeds } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { useSeniors } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import type { Medication } from "@/lib/care-types";
import type { Senior } from "@/lib/types";
import { IssueList, VerifyDialog } from "@/features/care/MedicationDialogs";
import { NeedsSenior } from "@/features/care/shared";

function SeniorSafety({ hid, senior }: { hid: string; senior: Senior }) {
  const meds = useMeds(hid, senior.id);
  const review = useMedReview(hid, senior.id);
  const { can } = useCareContext();
  const [verifying, setVerifying] = useState<string | null>(null);
  if (meds.isError && meds.error instanceof ApiError && meds.error.status === 403)
    return <Card className="p-5 text-sm text-ink-500">{senior.fullName} has not shared medications with you.</Card>;
  if (meds.isLoading) return <Skeleton className="h-40" />;
  if (meds.isError) return <ErrorState error={meds.error} />;
  const pending = meds.data!.filter((m) => m.status === "pending_verification");
  const low = meds.data!.filter((m) => m.refill.tracked && m.refill.level !== "ok");
  const live = meds.data!.find((m) => m.id === verifying) ?? null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div><CardTitle>{senior.fullName}</CardTitle><CardDescription>{meds.data!.filter((m) => m.status === "active").length} active · {pending.length} awaiting verification</CardDescription></div>
        {pending.length === 0 && low.length === 0 && <Badge tone="brand"><CheckCircle2 className="size-3" /> Nothing needs attention</Badge>}
      </CardHeader>
      <CardContent className="space-y-5">
        {pending.length > 0 && (
          <section aria-label="Verification queue">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-warning-600" /> Prescription verification queue</h3>
            <ul className="space-y-3">
              {pending.map((m: Medication) => (
                <li key={m.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.name || <em className="text-warning-600">Name unclear</em>} {m.strength}</span>
                    {m.blockingCount > 0 ? <Badge tone="danger"><AlertOctagon className="size-3" /> {m.blockingCount} blocking</Badge> : <Badge tone="brand">Ready to verify</Badge>}
                    {can("meds.verify") && <Button size="sm" className="ml-auto" onClick={() => setVerifying(m.id)}><ShieldCheck /> Review</Button>}
                  </div>
                  <div className="mt-3"><IssueList med={m} compact /></div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {low.length > 0 && (
          <section aria-label="Refill alerts">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><PackageX className="size-4 text-danger-600" /> Refill intelligence</h3>
            <ul className="space-y-2">
              {low.map((m) => (
                <li key={m.id} className="rounded-xl bg-sage-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{m.name}</strong>
                    <Badge tone={m.refill.level === "low" ? "warning" : "danger"}>{m.refill.level === "out" ? "Out of stock" : `~${m.refill.daysRemaining} days left`}</Badge>
                    <span className="text-xs text-ink-500">Projected to run out {m.refill.depletionDate}</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-700">{m.refill.checklist?.map((c) => <li key={c}>{c}</li>)}</ul>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Interaction review" className="rounded-xl border border-line p-4 text-sm">
          <h3 className="mb-1 flex items-center gap-2 font-semibold"><Info className="size-4 text-info-600" /> Medication interaction review</h3>
          {review.isLoading ? <Skeleton className="h-10" /> : review.data && (
            <>
              <p className="text-ink-700">{review.data.reason}</p>
              {review.data.duplicates.length > 0 && (
                <p className="mt-2 rounded-lg bg-warning-50 p-2 text-warning-600">Possible duplicate entries: {review.data.duplicates.map((d) => d.name).join(", ")} — confirm with the prescriber.</p>
              )}
            </>
          )}
        </section>
      </CardContent>
      <VerifyDialog hid={hid} sid={senior.id} med={live} onClose={() => setVerifying(null)} />
    </Card>
  );
}

export function MedicationSafetyPage() {
  const { membership, householdId } = useCareContext();
  const seniors = useSeniors(householdId ?? undefined);
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Medication Safety"
        description="The Prescription Confusion Firewall: nothing becomes a schedule until an authorised person resolves every ambiguity and verifies it." />
      <Card className="mb-6 p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          {[
            ["1. Enter or transcribe", "Copy the prescription exactly as written and flag anything unclear."],
            ["2. Ambiguity detector", "Missing fields, unclear handwriting, frequency conflicts and error-prone notation (e.g. “QD”, “.5 mg”) block activation."],
            ["3. Human verification", "A family administrator or primary caregiver checks against the original and activates the schedule."],
          ].map(([t, d]) => <div key={t}><p className="font-semibold">{t}</p><p className="mt-1 text-ink-500">{d}</p></div>)}
        </div>
      </Card>
      <NeedsSenior>{(hid) => (
        <div className="space-y-6">
          {(seniors.data ?? []).map((s) => <SeniorSafety key={s.id} hid={hid} senior={s} />)}
        </div>
      )}</NeedsSenior>
    </>
  );
}
