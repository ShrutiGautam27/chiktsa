/** Shared building blocks for care pages: profile picker, member select, badges, time display. */
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Home, UserRound } from "lucide-react";
import { Badge, Skeleton } from "@/components/ui/misc";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe, useMembers, useSeniors } from "@/hooks/queries";
import type { Senior } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Format a UTC instant in a specific IANA zone. */
export function fmt(iso: string | null | undefined, tz?: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
  }
}

/**
 * Family Time-Zone Coordinator: shows the time in the viewer's zone, plus the senior's local time
 * when the two differ (e.g. a grandchild abroad).
 */
export function DualTime({ iso, seniorTz, className, timeOnly }: { iso: string; seniorTz?: string | null; className?: string; timeOnly?: boolean }) {
  const me = useMe();
  const myTz = me.data?.user.timezone;
  const opts: Intl.DateTimeFormatOptions = timeOnly ? { timeStyle: "short" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  const mine = fmt(iso, myTz, opts);
  const theirs = seniorTz ? fmt(iso, seniorTz, opts) : null;
  const differs = seniorTz && myTz && theirs !== mine;
  return (
    <span className={className}>
      <time dateTime={iso}>{mine}</time>
      {differs && <span className="ml-1.5 text-xs text-ink-500" title={`Local time for the senior (${seniorTz})`}>({theirs} their time)</span>}
    </span>
  );
}

/** Pick which elderly profile a page is about; synced with the Universal Care Switcher. */
export function useActiveSenior() {
  const { householdId, seniorId, setSenior } = useCareContext();
  const seniors = useSeniors(householdId ?? undefined);
  const list = seniors.data ?? [];
  const current = list.find((s) => s.id === seniorId) ?? list[0];
  useEffect(() => {
    if (!seniorId && list.length === 1) setSenior(list[0]!.id);
  }, [seniorId, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return { householdId, senior: current as Senior | undefined, seniors: list, loading: seniors.isLoading, setSenior };
}

export function ProfilePicker() {
  const { senior, seniors, setSenior } = useActiveSenior();
  if (seniors.length < 2) return null;
  return (
    <div role="tablist" aria-label="Elderly profile" className="mb-6 flex flex-wrap gap-2">
      {seniors.map((s) => (
        <button key={s.id} role="tab" aria-selected={s.id === senior?.id} onClick={() => setSenior(s.id)}
          className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            s.id === senior?.id ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-line bg-surface hover:bg-sage-50")}>
          <UserRound className="size-3.5" aria-hidden /> {s.preferredName || s.fullName}
        </button>
      ))}
    </div>
  );
}

/** Wraps a page that needs a household + profile, with honest empty states. */
export function NeedsSenior({ children }: { children: (hid: string, senior: Senior) => ReactNode }) {
  const { householdId, senior, loading } = useActiveSenior();
  if (!householdId)
    return <EmptyState icon={Home} title="No household selected" description="Create or join a household first." action={<Button asChild><Link to="/app/households?new=1">Create household</Link></Button>} />;
  if (loading) return <Skeleton className="h-64" />;
  if (!senior) return <EmptyState icon={UserRound} title="No elderly profiles yet" description="Add a profile to start recording care." action={<Button asChild><Link to="/app/profiles">Go to profiles</Link></Button>} />;
  return <>{children(householdId, senior)}</>;
}

export function MemberSelect({ hid, value, onChange, seniorId, placeholder = "Unassigned", excludeSeniors = true, id, filter }: {
  hid: string;
  value: string;
  onChange: (v: string) => void;
  seniorId?: string | null;
  placeholder?: string;
  excludeSeniors?: boolean;
  id?: string;
  filter?: (role: string) => boolean;
}) {
  const members = useMembers(hid);
  const opts = (members.data ?? []).filter((m) =>
    m.status === "active" && (!excludeSeniors || m.role !== "senior") && (!filter || filter(m.role)) &&
    (!seniorId || m.role === "household_owner" || m.role === "family_admin" || m.seniorScope === "all" || m.seniorScope.includes(seniorId)),
  );
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opts.map((m) => <option key={m.uid} value={m.uid}>{m.displayName} — {m.roleLabel}</option>)}
    </NativeSelect>
  );
}

const MED_STATUS: Record<string, { label: string; tone: "warning" | "brand" | "neutral" | "sage" }> = {
  pending_verification: { label: "Awaiting verification", tone: "warning" },
  active: { label: "Active", tone: "brand" },
  paused: { label: "Paused", tone: "neutral" },
  ended: { label: "Ended", tone: "sage" },
};
export function MedStatusBadge({ status }: { status: string }) {
  const s = MED_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const TASK_STATUS: Record<string, { label: string; tone: "warning" | "brand" | "neutral" | "sage" | "info" | "danger" }> = {
  open: { label: "Unassigned", tone: "warning" },
  assigned: { label: "Awaiting acceptance", tone: "info" },
  accepted: { label: "Accepted", tone: "brand" },
  done: { label: "Done", tone: "sage" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
export function TaskStatusBadge({ status }: { status: string }) {
  const s = TASK_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: "high" | "medium" | "low" }) {
  const tone = severity === "high" ? "danger" : severity === "medium" ? "warning" : "info";
  return <Badge tone={tone}>{severity === "high" ? "Needs attention" : severity === "medium" ? "Soon" : "Low"}</Badge>;
}

export const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
