import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, Home, Mail, Plus, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { EmptyState, ErrorState, PageHeader, StatCard } from "@/components/common";
import { useAcceptInvitation, useHouseholds, useMe, useMyInvitations, useSeniors } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { HouseholdFormDialog } from "@/features/HouseholdFormDialog";
import { SeniorFormDialog } from "@/features/SeniorFormDialog";
import { AuditFeed } from "@/features/AuditFeed";
import { errorMessage } from "@/lib/api";
import { greeting } from "@/lib/utils";
import { SeniorOverview } from "./SeniorProfilePage";
import { GapList } from "./ContinuityPage";
import { useHouseholdAppointments, useResponsibilities } from "@/hooks/care-queries";
import { DualTime } from "@/features/care/shared";
import { BriefingCard } from "@/features/ai/components";

export function PendingInvitationsBanner() {
  const inv = useMyInvitations();
  const accept = useAcceptInvitation();
  const { setHousehold } = useCareContext();
  if (!inv.data?.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {inv.data.map((i) => (
        <div key={i.id} className="flex flex-col gap-3 rounded-2xl border border-champagne-300 bg-champagne-50 p-4 sm:flex-row sm:items-center">
          <Mail className="size-5 shrink-0 text-champagne-700" aria-hidden />
          <p className="flex-1 text-sm"><strong>{i.invitedByName}</strong> invited you to <strong>{i.householdName}</strong> as {i.roleLabel}.</p>
          <Button size="sm" loading={accept.isPending && accept.variables?.id === i.id}
            onClick={() => accept.mutate({ id: i.id }, {
              onSuccess: (r) => { setHousehold(r.householdId); toast.success(`You joined ${i.householdName}`); },
              onError: (e) => toast.error(errorMessage(e)),
            })}>
            Accept invitation
          </Button>
        </div>
      ))}
    </div>
  );
}

function CareToday({ hid }: { hid: string }) {
  const { can } = useCareContext();
  const appts = useHouseholdAppointments(hid, 7, can("senior.medical.read"));
  const resp = useResponsibilities();
  const mine = (resp.data?.myTasks.length ?? 0) + (resp.data?.coverRequests.length ?? 0) + (resp.data?.handoversToAcknowledge.length ?? 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="lg:col-span-2"><BriefingCard hid={hid} /></div>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle>Care gaps</CardTitle><CardDescription>Responsibilities that need an owner or a response.</CardDescription></div>
          <Button asChild variant="ghost" size="sm"><Link to="/app/continuity">All gaps <ArrowRight /></Link></Button>
        </CardHeader>
        <CardContent><GapList hid={hid} limit={4} /></CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Waiting on you</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link to="/app/tasks">Open <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent>
            {resp.isLoading ? <Skeleton className="h-10" /> : mine === 0 ? <p className="text-sm text-ink-500">Nothing is waiting on you.</p> : (
              <ul className="space-y-1 text-sm">
                {resp.data!.coverRequests.length > 0 && <li className="text-warning-600">{resp.data!.coverRequests.length} cover request(s)</li>}
                {resp.data!.handoversToAcknowledge.length > 0 && <li>{resp.data!.handoversToAcknowledge.length} handover(s) to acknowledge</li>}
                {resp.data!.myTasks.length > 0 && <li>{resp.data!.myTasks.length} task(s) assigned to you</li>}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Next 7 days</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link to="/app/appointments">Appointments <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent>
            {!can("senior.medical.read") ? <p className="text-sm text-ink-500">Appointments aren't shared with your role.</p>
              : appts.isLoading ? <Skeleton className="h-16" /> : !appts.data?.length ? <p className="text-sm text-ink-500">No appointments this week.</p> : (
                <ul className="space-y-2">{appts.data.slice(0, 4).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                    <span className="min-w-0"><span className="font-medium">{a.title}</span> · {a.seniorName}<span className="block text-xs text-ink-500"><DualTime iso={a.startsAt} />{a.escortName ? ` · with ${a.escortName}` : " · no one accompanying yet"}</span></span>
                  </li>))}</ul>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const me = useMe();
  const households = useHouseholds();
  const { householdId, seniorId, membership, can, setSenior } = useCareContext();
  const seniors = useSeniors(householdId ?? undefined);
  const [createHousehold, setCreateHousehold] = useState(false);
  const [addSenior, setAddSenior] = useState(false);
  const name = me.data?.user.displayName.split(" ")[0] ?? "";

  if (me.isLoading || households.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div></div>;
  }
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  if (!households.data?.length) {
    return (
      <>
        <PageHeader eyebrow={greeting()} title={`Welcome to Chiktsa, ${name}`} description="Let's set up your first care space." />
        <PendingInvitationsBanner />
        <EmptyState icon={Home} title="Create your first household"
          description="A household is a private, isolated care space. Add each elderly person as their own profile, then invite your care circle."
          action={<Button size="lg" onClick={() => setCreateHousehold(true)}><Plus /> Create household</Button>} />
        <HouseholdFormDialog open={createHousehold} onOpenChange={setCreateHousehold} />
      </>
    );
  }

  // Individual elderly profile dashboard
  if (seniorId && householdId) {
    return (
      <>
        <PageHeader eyebrow={membership?.householdName} title="Profile dashboard"
          actions={<Button variant="outline" onClick={() => setSenior(null)}>Back to household overview</Button>} />
        <SeniorOverview hid={householdId} sid={seniorId} />
      </>
    );
  }

  const totalProfiles = households.data.reduce((a, h) => a + h.seniorCount, 0);
  return (
    <>
      <PageHeader eyebrow={greeting()} title={`Hello, ${name}`}
        description={membership ? <>You're viewing <strong className="text-ink-900">{membership.householdName}</strong> as {membership.roleLabel.toLowerCase()}.</> : undefined}
        actions={can("seniors.manage") && <Button onClick={() => setAddSenior(true)}><Plus /> Add profile</Button>} />
      <PendingInvitationsBanner />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Households" value={households.data.length} icon={Home} hint="You belong to" />
        <StatCard label="Active elderly profiles" value={totalProfiles} icon={UserRound} tone="champagne" hint="Across all your households" />
        <StatCard label="Care circle (this household)" value={households.data.find((h) => h.id === householdId)?.memberCount ?? "—"} icon={Users} tone="sage" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Elderly profiles</CardTitle><CardDescription>Each profile's records are kept separate.</CardDescription></div>
            <Button asChild variant="ghost" size="sm"><Link to="/app/profiles">View all <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent>
            {seniors.isLoading ? <Skeleton className="h-24" /> : seniors.isError ? <ErrorState error={seniors.error} /> : !seniors.data?.length ? (
              <EmptyState icon={UserRound} title="No profiles yet" description={can("seniors.manage") ? "Add the first elderly person you care for." : "An administrator hasn't shared any profiles with you yet."}
                action={can("seniors.manage") && <Button onClick={() => setAddSenior(true)}><Plus /> Add profile</Button>} />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {seniors.data.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setSenior(s.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-4 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40">
                      <span className="inline-flex size-11 items-center justify-center rounded-full bg-champagne-100 font-display text-champagne-700">{s.fullName[0]}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{s.fullName}</span>
                        <span className="block text-xs text-ink-500">{[s.age != null && `${s.age} yrs`, s.primaryLanguage === "hi" ? "Hindi" : "English"].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent care activity</CardTitle></CardHeader>
          <CardContent>
            {householdId && can("audit.read") ? <AuditFeed hid={householdId} limit={6} /> : (
              <p className="text-sm text-ink-500">Activity history is visible to household administrators.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {households.data.length > 1 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>All your households</CardTitle><CardDescription>Switch with the selector at the top — medical information stays separated per household.</CardDescription></CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {households.data.map((h) => (
                <li key={h.id}>
                  <Link to={`/app/households/${h.id}`} className="block rounded-2xl border border-line p-4 hover:bg-sage-50">
                    <div className="font-medium">{h.name}</div>
                    <div className="mt-1 text-xs text-ink-500">{h.seniorCount} profiles · {h.memberCount} members</div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {householdId && <div className="mt-6"><CareToday hid={householdId} /></div>}
      {householdId && <SeniorFormDialog open={addSenior} onOpenChange={setAddSenior} householdId={householdId} />}
    </>
  );
}
