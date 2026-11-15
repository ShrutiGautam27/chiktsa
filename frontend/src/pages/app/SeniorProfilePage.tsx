import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, Globe, Pencil, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Avatar, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/overlay";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useArchiveSenior, useHousehold, useMembers, useSenior } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { SeniorFormDialog } from "@/features/SeniorFormDialog";
import { TodayDoses } from "@/features/care/TodayDoses";
import { GapList } from "./ContinuityPage";
import { CareNotesCard } from "@/features/ai/components";
import { WellnessTrend, WishesCard } from "@/features/phase5/components";
import { AuditFeed } from "@/features/AuditFeed";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/utils";

/** Per-profile dashboard body (also used on the main dashboard when a profile is selected). */
export function SeniorOverview({ hid, sid }: { hid: string; sid: string }) {
  const senior = useSenior(hid, sid);
  const members = useMembers(hid);
  const household = useHousehold(hid);
  const { membership } = useCareContext();
  const perms = membership?.householdId === hid ? membership.permissions : [];
  const can = (p: string) => perms.includes(p);
  const [edit, setEdit] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archive = useArchiveSenior(hid);
  const navigate = useNavigate();
  const { setSenior } = useCareContext();

  if (senior.isLoading) return <div className="space-y-4"><Skeleton className="h-36" /><Skeleton className="h-64" /></div>;
  if (senior.isError) return <ErrorState error={senior.error} onRetry={() => senior.refetch()} />;
  const s = senior.data!;
  const carers = (members.data ?? []).filter((m) => m.role !== "senior" && (m.seniorScope === "all" || m.seniorScope.includes(sid)));
  const selfMember = (members.data ?? []).find((m) => m.role === "senior" && m.linkedSeniorId === sid);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 bg-gradient-to-br from-brand-50 to-champagne-50 p-6 sm:flex-row sm:items-center">
          <span className="inline-flex size-20 items-center justify-center rounded-3xl bg-surface font-display text-3xl text-brand-700 shadow-soft">{s.fullName[0]}</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl">{s.fullName}</h2>
            {s.preferredName && <p className="text-ink-500">Prefers “{s.preferredName}”</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.age != null && <Badge tone="neutral">{s.age} years</Badge>}
              <Badge tone="neutral"><Globe className="size-3" /> {s.primaryLanguage === "hi" ? "Hindi" : "English"}</Badge>
              {s.timezone && <Badge tone="neutral">{s.timezone}</Badge>}
              {selfMember && <Badge tone="brand">Uses CareHub</Badge>}
            </div>
          </div>
          {can("seniors.manage") && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit</Button>
              <Button variant="ghost" onClick={() => setArchiving(true)} aria-label="Archive profile"><Archive /></Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Today's medication schedule</CardTitle><CardDescription>Records for {s.preferredName || s.fullName} only.</CardDescription></div>
            <Button asChild variant="ghost" size="sm"><Link to="/app/medications">Medications</Link></Button>
          </CardHeader>
          <CardContent>{can("senior.medical.read") ? <TodayDoses hid={hid} senior={s} /> : <p className="text-sm text-ink-500">Not shared with your role.</p>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Trusted contacts</CardTitle></CardHeader>
          <CardContent>
            {s.emergencyContacts.length ? (
              <ul className="space-y-2">
                {s.emergencyContacts.map((c) => (
                  <li key={c.phone + c.name} className="flex items-center gap-3 rounded-xl bg-sage-50 p-3">
                    <Phone className="size-4 text-brand-600" aria-hidden />
                    <div className="min-w-0 flex-1 text-sm"><div className="font-medium">{c.name}</div><div className="text-xs text-ink-500">{c.relationship || "Contact"}</div></div>
                    <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="text-sm font-medium text-brand-700 hover:underline">{c.phone}</a>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">No trusted contacts recorded.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Care team</CardTitle><CardDescription>Members with access to this profile</CardDescription></CardHeader>
          <CardContent>
            {members.isLoading ? <Skeleton className="h-20" /> : (
              <ul className="space-y-2">
                {carers.map((m) => (
                  <li key={m.uid} className="flex items-center gap-3">
                    <Avatar name={m.displayName} className="size-8 text-xs" />
                    <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{m.displayName}</div><div className="text-xs text-ink-500">{m.roleLabel}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Care preferences & notes</CardTitle></CardHeader>
          <CardContent>
            {s.notes ? <p className="whitespace-pre-wrap text-sm text-ink-700">{s.notes}</p> : <p className="text-sm text-ink-500">No notes yet.</p>}
            <p className="mt-4 text-xs text-ink-500">Profile created {formatDate(s.createdAt)} · {household.data?.name}</p>
          </CardContent>
        </Card>

        <div className="lg:col-span-3"><CareNotesCard hid={hid} sid={sid} name={s.preferredName || s.fullName} /></div>
        <div className="lg:col-span-3"><WellnessTrend hid={hid} sid={sid} /></div>
        <div className="lg:col-span-3"><WishesCard hid={hid} sid={sid} name={s.preferredName || s.fullName} /></div>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Care gaps for {s.preferredName || s.fullName}</CardTitle><CardDescription>AI-generated insights arrive in Phase 4; these are rule-based responsibility checks.</CardDescription></CardHeader>
          <CardContent><GapList hid={hid} sid={sid} /></CardContent>
        </Card>

        {can("audit.read") && (
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle>Care history</CardTitle><CardDescription>Every change to this profile, with previous and current values.</CardDescription></CardHeader>
            <CardContent><AuditFeed hid={hid} seniorId={sid} limit={20} /></CardContent>
          </Card>
        )}
      </div>

      <SeniorFormDialog open={edit} onOpenChange={setEdit} householdId={hid} senior={s} />
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title={`Archive ${s.fullName}'s profile?`}
        description="The profile will be hidden from the care circle. Its history is retained for audit and is never deleted."
        confirmLabel="Archive profile" destructive loading={archive.isPending}
        onConfirm={() => archive.mutate(sid, {
          onSuccess: () => { toast.success("Profile archived"); setArchiving(false); setSenior(null); navigate("/app/profiles"); },
          onError: (e) => toast.error(errorMessage(e)),
        })} />
    </div>
  );
}

export function SeniorProfilePage() {
  const { hid, sid } = useParams();
  const household = useHousehold(hid);
  return (
    <>
      <PageHeader eyebrow={<Link to={`/app/households/${hid}`} className="hover:underline">{household.data?.name ?? "Household"}</Link>} title="Elderly profile" />
      {hid && sid ? <SeniorOverview hid={hid} sid={sid} /> : <EmptyState icon={UserRound} title="Profile not found" description="Check the link and try again." />}
    </>
  );
}
