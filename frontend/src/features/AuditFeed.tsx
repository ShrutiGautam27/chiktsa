/** Audit feed — foundation of the Care Change Detective: what changed, when, who, previous → current. */
import { History } from "lucide-react";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/common";
import { useAudit } from "@/hooks/queries";
import { formatDateTime, relativeTime } from "@/lib/utils";

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length > 1 ? "s" : ""}` : "none";
  if (typeof v === "object") return "updated";
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

const FIELD_LABELS: Record<string, string> = {
  seniorScope: "Profile access", linkedSeniorId: "Linked profile", expiresAt: "Access ends", fullName: "Full name",
  preferredName: "Preferred name", dateOfBirth: "Date of birth", emergencyContacts: "Trusted contacts", primaryLanguage: "Language",
};

export function AuditFeed({ hid, seniorId, limit }: { hid: string; seniorId?: string; limit?: number }) {
  const q = useAudit(hid, seniorId);
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = (q.data ?? []).slice(0, limit);
  if (!items.length) return <EmptyState icon={History} title="No activity yet" description="Changes to this care space will appear here." />;
  return (
    <ol className="space-y-1">
      {items.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-xl p-3 hover:bg-sage-50">
          <Avatar name={e.actorName} className="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="text-sm"><span className="font-medium">{e.actorName}</span> <span className="text-ink-700">{e.summary.charAt(0).toLowerCase() + e.summary.slice(1)}</span></p>
            {e.changes && Object.keys(e.changes).length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-500">
                {Object.entries(e.changes).map(([k, c]) => (
                  <li key={k}><span className="font-medium text-ink-700">{FIELD_LABELS[k] ?? k}:</span> <span className="line-through decoration-ink-300">{show(c.from)}</span> → <span className="text-ink-900">{show(c.to)}</span></li>
                ))}
              </ul>
            )}
            <time className="mt-0.5 block text-xs text-ink-500" dateTime={e.at} title={formatDateTime(e.at)}>{relativeTime(e.at)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
