/** Today's dose list with one-tap recording. Kept separate from chart-heavy pages (bundle size). */
import { toast } from "sonner";
import { Check, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ErrorState } from "@/components/common";
import { useQueryClient } from "@tanstack/react-query";
import { ck, useDoses, useRecordDose } from "@/hooks/care-queries";
import { enqueue, isOfflineError } from "@/lib/offline";
import { useCareContext } from "@/hooks/useCareContext";
import { errorMessage } from "@/lib/api";
import type { DoseEvent } from "@/lib/care-types";
import type { Senior } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DualTime } from "./shared";

const DOSE_TONE: Record<DoseEvent["status"], string> = {
  taken: "bg-brand-50 text-brand-700", skipped: "bg-ivory-deep text-ink-700", unconfirmed: "bg-warning-50 text-warning-600", scheduled: "bg-sage-50 text-ink-500",
};
const DOSE_LABEL: Record<DoseEvent["status"], string> = { taken: "Taken", skipped: "Skipped", unconfirmed: "Not recorded yet", scheduled: "Upcoming" };

export function TodayDoses({ hid, senior, large }: { hid: string; senior: Senior; large?: boolean }) {
  const doses = useDoses(hid, senior.id);
  const record = useRecordDose(hid, senior.id);
  const qc = useQueryClient();
  const { can } = useCareContext();
  const canRecord = can("care.log.write");
  if (doses.isLoading) return <Skeleton className="h-32" />;
  if (doses.isError) return <ErrorState error={doses.error} onRetry={() => doses.refetch()} />;
  if (!doses.data?.length) return <p className={cn("text-ink-500", large ? "text-xl" : "text-sm")}>No verified doses are scheduled today.</p>;
  const act = (d: DoseEvent, status: "taken" | "skipped") =>
    record.mutate({ medicationId: d.medicationId, scheduledFor: d.scheduledFor, status }, {
      onSuccess: () => toast.success(status === "taken" ? "Recorded as taken" : "Recorded as skipped"),
      onError: (e) => {
        if (!isOfflineError(e)) return toast.error(errorMessage(e));
        // Internet Independence Mode: keep the record on this device and sync it later.
        enqueue({ type: "dose.record", householdId: hid, seniorId: senior.id, label: `${d.medicationName} dose`,
                  payload: { medicationId: d.medicationId, scheduledFor: d.scheduledFor, status } });
        qc.setQueryData(ck.doses(hid, senior.id, "today"), (old: DoseEvent[] | undefined) =>
          old?.map((x) => (x.id === d.id ? { ...x, status, recordedBy: "you (offline)" } : x)));
        toast.info("You're offline — saved on this device and will sync automatically.");
      },
    });
  return (
    <ul className="space-y-2">
      {doses.data.map((d) => {
        const future = new Date(d.scheduledFor).getTime() - Date.now() > 2 * 3600_000;
        return (
          <li key={d.id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-line p-3", large && "rounded-2xl border-2 p-5")}>
            <div className={cn("w-16 shrink-0 font-display text-ink-900", large ? "text-2xl" : "text-lg")}><DualTime iso={d.scheduledFor} seniorTz={senior.timezone} timeOnly /></div>
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", large && "text-xl")}>{d.medicationName}</p>
              <p className={cn("text-ink-500", large ? "text-base" : "text-xs")}>{d.doseQuantity} {d.doseUnit}{d.instructions ? ` · ${d.instructions}` : ""}{d.recordedBy ? ` · recorded by ${d.recordedBy}` : ""}</p>
            </div>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", DOSE_TONE[d.status])}>{DOSE_LABEL[d.status]}</span>
            {canRecord && !future && (
              <div className="flex gap-2">
                <Button size={large ? "lg" : "sm"} variant={d.status === "taken" ? "primary" : "outline"} onClick={() => act(d, "taken")} aria-label={`Mark ${d.medicationName} taken`}><Check /> {large ? "I took it" : "Taken"}</Button>
                <Button size={large ? "lg" : "sm"} variant="ghost" onClick={() => act(d, "skipped")} aria-label={`Mark ${d.medicationName} skipped`}><SkipForward /> Skip</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

