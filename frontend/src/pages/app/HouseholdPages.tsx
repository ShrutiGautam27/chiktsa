import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Home, Pencil, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useHousehold, useHouseholds, useMe, useSeniors } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { HouseholdFormDialog } from "@/features/HouseholdFormDialog";
import { SeniorFormDialog } from "@/features/SeniorFormDialog";
import { CareCircle } from "@/features/CareCircle";
import { AuditFeed } from "@/features/AuditFeed";
import { AISettingsCard } from "@/features/ai/components";
import { ConnectOrgCard } from "@/features/wellbeing/components";
import { ROLE_LABELS } from "@/lib/types";

export function HouseholdsPage() {
  const households = useHouseholds();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  useEffect(() => { if (params.get("new") === "1") setOpen(true); }, [params]);
  const onOpenChange = (o: boolean) => { setOpen(o); if (!o && params.get("new")) setParams({}, { replace: true }); };

  return (
    <>
      <PageHeader title="Households" description="Each household is a separate, private care space. You can belong to several."
        actions={<Button onClick={() => setOpen(true)}><Plus /> New household</Button>} />
      {households.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : households.isError ? (
        <ErrorState error={households.error} onRetry={() => households.refetch()} />
      ) : !households.data?.length ? (
        <EmptyState icon={Home} title="No households yet" description="Create a household, or accept an invitation from your family." action={<Button onClick={() => setOpen(true)}><Plus /> Create household</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {households.data.map((h) => (
            <Link key={h.id} to={`/app/households/${h.id}`} className="group">
              <Card className="h-full p-6 transition-shadow group-hover:shadow-lift">
                <div className="flex items-start justify-between">
                  <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Home className="size-5" /></span>
                  {h.myRole && <Badge tone={h.myRole === "household_owner" ? "champagne" : "brand"}>{ROLE_LABELS[h.myRole]}</Badge>}
                </div>
                <h2 className="mt-4 font-display text-xl">{h.name}</h2>
                <p className="mt-1 text-sm text-ink-500">{h.seniorCount} elderly {h.seniorCount === 1 ? "profile" : "profiles"} · {h.memberCount} {h.memberCount === 1 ? "member" : "members"}</p>
                <p className="mt-3 text-xs text-ink-500">{h.timezone}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <HouseholdFormDialog open={open} onOpenChange={onOpenChange} />
    </>
  );
}

export function ProfilesGrid({ hid, canManage }: { hid: string; canManage: boolean }) {
  const seniors = useSeniors(hid);
  const [add, setAdd] = useState(false);
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl">Elderly profiles</h2>
        {canManage && <Button onClick={() => setAdd(true)}><Plus /> Add profile</Button>}
      </div>
      {seniors.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : seniors.isError ? (
        <ErrorState error={seniors.error} onRetry={() => seniors.refetch()} />
      ) : !seniors.data?.length ? (
        <EmptyState icon={UserRound} title="No profiles yet"
          description={canManage ? "Add each elderly person as their own profile — grandparents, an uncle, anyone you care for." : "No profiles have been shared with you in this household."}
          action={canManage && <Button onClick={() => setAdd(true)}><Plus /> Add profile</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seniors.data.map((s) => (
            <Link key={s.id} to={`/app/households/${hid}/profiles/${s.id}`} className="group">
              <Card className="flex h-full items-center gap-4 p-5 transition-shadow group-hover:shadow-lift">
                <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-champagne-100 font-display text-xl text-champagne-700">{s.fullName[0]}</span>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{s.fullName}</h3>
                  <p className="text-sm text-ink-500">{[s.age != null && `${s.age} years`, s.primaryLanguage === "hi" ? "Hindi" : "English"].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 text-xs text-ink-500">{s.emergencyContacts.length} trusted {s.emergencyContacts.length === 1 ? "contact" : "contacts"}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <SeniorFormDialog open={add} onOpenChange={setAdd} householdId={hid} />
    </>
  );
}

export function HouseholdDetailPage() {
  const { hid } = useParams();
  const household = useHousehold(hid);
  const me = useMe();
  const { setHousehold, householdId } = useCareContext();
  const [edit, setEdit] = useState(false);
  const membership = me.data?.memberships.find((m) => m.householdId === hid);
  const can = (p: string) => !!membership?.permissions.includes(p);

  // Opening a household focuses the Universal Care Switcher on it.
  useEffect(() => { if (hid && membership && householdId !== hid) setHousehold(hid); }, [hid, membership]); // eslint-disable-line react-hooks/exhaustive-deps

  if (household.isLoading || me.isLoading) return <Skeleton className="h-64" />;
  if (household.isError || !membership) return <ErrorState error={household.error ?? new Error("Household not found.")} />;
  const h = household.data!;

  return (
    <>
      <PageHeader eyebrow="Household" title={h.name} description={`${h.timezone} · You are ${membership.roleLabel.toLowerCase()}`}
        actions={can("household.manage") && <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit</Button>} />
      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="circle">Care circle</TabsTrigger>
          {can("audit.read") && <TabsTrigger value="activity">Activity</TabsTrigger>}
          <TabsTrigger value="ai">AI & privacy</TabsTrigger>
        </TabsList>
        <TabsContent value="profiles"><ProfilesGrid hid={h.id} canManage={can("seniors.manage")} /></TabsContent>
        <TabsContent value="circle"><div className="space-y-8"><CareCircle hid={h.id} myRole={membership.role} canManage={can("members.manage")} /><ConnectOrgCard hid={h.id} /></div></TabsContent>
        {can("audit.read") && <TabsContent value="activity"><Card className="p-3"><AuditFeed hid={h.id} /></Card></TabsContent>}
        <TabsContent value="ai"><AISettingsCard hid={h.id} /></TabsContent>
      </Tabs>
      <HouseholdFormDialog open={edit} onOpenChange={setEdit} household={h} />
    </>
  );
}

/** Pages bound to the household currently selected in the Universal Care Switcher. */
function NeedsHousehold({ children }: { children: (hid: string) => React.ReactNode }) {
  const { householdId, isLoading } = useCareContext();
  if (isLoading) return <Skeleton className="h-64" />;
  if (!householdId)
    return <EmptyState icon={Home} title="No household selected" description="Create or join a household first." action={<Button asChild><Link to="/app/households?new=1">Create household</Link></Button>} />;
  return <>{children(householdId)}</>;
}

export function ProfilesPage() {
  const { membership, can } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Elderly profiles" description="Every profile maintains its own records, preferences and history." />
      <NeedsHousehold>{(hid) => <ProfilesGrid hid={hid} canManage={can("seniors.manage")} />}</NeedsHousehold>
    </>
  );
}

export function CirclePage() {
  const { membership, can } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Family Care Circle" description="Who is part of this household's care, their role, and which profiles they can see." />
      <NeedsHousehold>{(hid) => <CareCircle hid={hid} myRole={membership!.role} canManage={can("members.manage")} />}</NeedsHousehold>
    </>
  );
}

export function ActivityPage() {
  const { membership } = useCareContext();
  return (
    <>
      <PageHeader eyebrow={membership?.householdName} title="Activity log" description="What changed, when, who changed it, and the previous and current values." />
      <NeedsHousehold>{(hid) => <Card className="p-3"><AuditFeed hid={hid} /></Card>}</NeedsHousehold>
    </>
  );
}
