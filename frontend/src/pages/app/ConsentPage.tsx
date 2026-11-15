import { useState } from "react";
import { toast } from "sonner";
import { Clock, HeartHandshake, Lock, RotateCcw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useConsentAction, useConsents } from "@/hooks/care-queries";
import { useCareContext } from "@/hooks/useCareContext";
import { ApiError, errorMessage } from "@/lib/api";
import { CATEGORY_LABELS, type ConsentView } from "@/lib/care-types";
import type { Senior } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";
import { NeedsSenior, ProfilePicker, fmt } from "@/features/care/shared";

const STATE: Record<string, { label: string; tone: "brand" | "warning" | "danger" | "neutral" | "champagne" }> = {
  full: { label: "Standard access", tone: "brand" }, limited: { label: "Limited", tone: "warning" },
  revoked: { label: "Revoked", tone: "danger" }, expired: { label: "Expired", tone: "neutral" }, owner: { label: "Owner", tone: "champagne" },
};

function EditAccess({ hid, sid, row, onClose }: { hid: string; sid: string; row: ConsentView["members"][number]; onClose: () => void }) {
  const action = useConsentAction(hid, sid);
  const [cats, setCats] = useState<string[]>(row.state === "limited" ? row.categories : Object.keys(CATEGORY_LABELS));
  const [until, setUntil] = useState(row.expiresAt ? row.expiresAt.slice(0, 10) : "");
  const save = () => action.mutate({ uid: row.uid, action: "set", categories: cats, expiresAt: until ? new Date(until + "T23:59:00").toISOString() : null }, {
    onSuccess: () => { toast.success(`Access updated for ${row.displayName}`); onClose(); }, onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`What can ${row.displayName} see?`} description="Basic profile details stay visible. Choose which records to share, and optionally when access ends.">
      <div className="space-y-4">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Shared records</legend>
          {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
            <label key={k} className={cn("flex items-center gap-3 rounded-xl border p-3 text-sm", cats.includes(k) ? "border-brand-500 bg-brand-50" : "border-line")}>
              <input type="checkbox" className="size-4 accent-brand-600" checked={cats.includes(k)} onChange={() => setCats(cats.includes(k) ? cats.filter((x) => x !== k) : [...cats, k])} /> {l}
            </label>
          ))}
        </fieldset>
        <Field label="Access ends (optional)" hint="Temporary access stops automatically on this date."><Input type="date" min={new Date().toISOString().slice(0, 10)} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={action.isPending}>Save access</Button></div>
      </div>
    </Dialog>
  );
}

function SeniorConsent({ hid, senior }: { hid: string; senior: Senior }) {
  const view = useConsents(hid, senior.id);
  const action = useConsentAction(hid, senior.id);
  const [editing, setEditing] = useState<ConsentView["members"][number] | null>(null);
  const [revoking, setRevoking] = useState<ConsentView["members"][number] | null>(null);
  if (view.isLoading) return <Skeleton className="h-64" />;
  if (view.isError) {
    if (view.error instanceof ApiError && view.error.status === 403)
      return <EmptyState icon={Lock} title="Managed by the senior" description={`${senior.fullName} decides who can see their care information. ${view.error.message}`} />;
    return <ErrorState error={view.error} onRetry={() => view.refetch()} />;
  }
  const v = view.data!;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Who can see {senior.preferredName || senior.fullName}'s care</CardTitle><CardDescription>Restrictions only ever narrow access granted by role. The household owner always keeps access.</CardDescription></CardHeader>
        <ul className="divide-y divide-line border-t border-line">
          {v.members.map((m) => (
            <li key={m.uid} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{m.displayName}</span><Badge tone={STATE[m.state]!.tone}>{STATE[m.state]!.label}</Badge>
                  {m.expiringSoon && <Badge tone="warning"><Clock className="size-3" /> Ends {fmt(m.expiresAt, undefined, { dateStyle: "medium" })}</Badge>}</div>
                <p className="text-xs text-ink-500">{m.roleLabel} · {m.state === "revoked" || m.state === "expired" ? "No access to this profile" : m.categories.map((c) => CATEGORY_LABELS[c]).join(", ") || "Profile basics only"}
                  {m.expiresAt && !m.expiringSoon && m.state === "limited" ? ` · until ${fmt(m.expiresAt, undefined, { dateStyle: "medium" })}` : ""}</p>
              </div>
              {m.restrictable && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Limit or time-box</Button>
                  {m.state !== "full" && <Button size="sm" variant="ghost" onClick={() => action.mutate({ uid: m.uid, action: "restore" }, { onSuccess: () => toast.success("Standard access restored"), onError: (e) => toast.error(errorMessage(e)) })}><RotateCcw /> Restore</Button>}
                  {m.state !== "revoked" && <Button size="sm" variant="ghost" className="text-danger-600" onClick={() => setRevoking(m)}><ShieldOff /> Revoke</Button>}
                </div>
              )}
            </li>
          ))}
          {!v.members.length && <li className="p-4 text-sm text-ink-500">No other members can see this profile.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader><CardTitle>Access history</CardTitle></CardHeader>
        <CardContent>{v.history.length ? <ul className="space-y-2 text-sm">{v.history.map((h, i) => <li key={i}><strong>{h.actorName}</strong> {h.summary.charAt(0).toLowerCase() + h.summary.slice(1)} <span className="text-xs text-ink-500">· {relativeTime(h.at)}</span></li>)}</ul> : <p className="text-sm text-ink-500">No changes yet.</p>}</CardContent>
      </Card>
      {editing && <EditAccess hid={hid} sid={senior.id} row={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title={`Revoke ${revoking?.displayName}'s access?`}
        description="They will immediately stop seeing this profile, its records and related tasks. You can restore access at any time." confirmLabel="Revoke access" destructive loading={action.isPending}
        onConfirm={() => revoking && action.mutate({ uid: revoking.uid, action: "revoke" }, { onSuccess: () => { toast.success("Access revoked"); setRevoking(null); }, onError: (e) => toast.error(errorMessage(e)) })} />
    </div>
  );
}

export function ConsentPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Consent & permissions" description="Seniors decide who sees what — grant, limit, time-box or revoke access, and review every change." />
      <ProfilePicker />
      <NeedsSenior>{(hid, senior) => <SeniorConsent key={senior.id} hid={hid} senior={senior} />}</NeedsSenior>
    </>
  );
}

export { HeartHandshake };
