/** Family Care Circle: members, roles, profile scope, temporary access, invitations. */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Copy, Mail, MoreHorizontal, ShieldOff, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Avatar, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/common";
import { useCreateInvitation, useInvitations, useMe, useMembers, useRemoveMember, useRevokeInvitation, useSeniors, useUpdateMember } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import { ROLE_LABELS, grantableRoles, type Member, type Role, type SeniorScope } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ScopePicker } from "./ScopePicker";

const ROLE_HELP: Record<Role, string> = {
  household_owner: "Full control of the household.",
  family_admin: "Manages profiles, members and permissions.",
  family_member: "Views care information and completes assigned tasks.",
  primary_caregiver: "Day-to-day care, medication records, verification and handovers.",
  secondary_caregiver: "Backup caregiver: tasks, observations and handovers.",
  org_admin: "Professional organisation administrator.",
  senior: "The elderly person themself — simplified interface, controls their own consent.",
};

function scopeLabel(scope: SeniorScope, names: Map<string, string>) {
  if (scope === "all") return "All profiles";
  if (!scope.length) return "No profiles";
  return scope.map((id) => names.get(id) ?? "Archived profile").join(", ");
}

function InviteDialog({ hid, myRole, open, onOpenChange }: { hid: string; myRole: Role; open: boolean; onOpenChange: (o: boolean) => void }) {
  const seniors = useSeniors(hid);
  const create = useCreateInvitation(hid);
  const roles = grantableRoles(myRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(roles.includes("family_member") ? "family_member" : roles[0]!);
  const [scope, setScope] = useState<SeniorScope>("all");
  const [linked, setLinked] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [until, setUntil] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [link, setLink] = useState<string | null>(null);

  const reset = () => { setEmail(""); setScope("all"); setLinked(""); setTemporary(false); setUntil(""); setErrors({}); setLink(null); };
  const adminRole = role === "family_admin";

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "Enter a valid email address";
    if (role === "senior" && !linked) errs.linked = "Choose which profile belongs to this person";
    if (role !== "senior" && !adminRole && scope !== "all" && scope.length === 0) errs.scope = "Select at least one profile";
    if (temporary && (!until || new Date(until) <= new Date())) errs.until = "Choose a future date and time";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const inv = await create.mutateAsync({
        email: email.trim(), role,
        seniorScope: role === "senior" || adminRole ? "all" : scope,
        ...(role === "senior" ? { linkedSeniorId: linked } : {}),
        ...(temporary ? { accessExpiresAt: new Date(until).toISOString() } : {}),
      });
      setLink(`${window.location.origin}/invite/${inv.token}`);
      toast.success(`Invitation created for ${inv.email}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }} title={link ? "Share the invitation" : "Invite to the care circle"}
      description={link ? undefined : "They'll join with exactly the role and profile access you choose. You can change or revoke it later."}>
      {link ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-champagne-300 bg-champagne-50 p-4 text-sm text-ink-700">
            <p className="font-medium text-ink-900">Email delivery isn't connected yet.</p>
            <p className="mt-1">Send this one-time link to the invitee yourself. It only works when they sign in with <strong>{email}</strong> and expires in 7 days. It won't be shown again.</p>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
            <Button type="button" variant="secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(link); toast.success("Link copied"); } catch { toast.error("Couldn't copy — select the link and copy it manually"); }
            }}><Copy /> Copy</Button>
          </div>
          <div className="flex justify-end"><Button onClick={() => { onOpenChange(false); reset(); }}><Check /> Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label="Email address" error={errors.email}><Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role" hint={ROLE_HELP[role]}>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </NativeSelect>
          </Field>
          {role === "senior" ? (
            <Field label="Which profile is theirs?" error={errors.linked}>
              <NativeSelect value={linked} onChange={(e) => setLinked(e.target.value)}>
                <option value="">Select a profile…</option>
                {seniors.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </NativeSelect>
            </Field>
          ) : adminRole ? (
            <p className="rounded-xl bg-sage-50 p-3 text-sm text-ink-500">Administrators always have access to every profile.</p>
          ) : (
            <ScopePicker seniors={seniors.data ?? []} value={scope} onChange={setScope} error={errors.scope} />
          )}
          <div className="space-y-3 rounded-xl border border-line p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" aria-label="Temporary access" className="size-4 accent-brand-600" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
              <Clock className="size-4 text-ink-500" /> Temporary access
            </label>
            {temporary && (
              <Field label="Access ends" error={errors.until}><Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending}><Mail /> Create invitation</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditMemberDialog({ hid, member, myRole, onClose }: { hid: string; member: Member | null; myRole: Role; onClose: () => void }) {
  const seniors = useSeniors(hid);
  const update = useUpdateMember(hid);
  const [role, setRole] = useState<Role>(member?.role ?? "family_member");
  const [scope, setScope] = useState<SeniorScope>(member?.seniorScope ?? "all");
  const [linked, setLinked] = useState(member?.linkedSeniorId ?? "");
  const [until, setUntil] = useState(member?.expiresAt ? member.expiresAt.slice(0, 16) : "");
  const [err, setErr] = useState<string | null>(null);
  const roles = Array.from(new Set([...(member ? [member.role] : []), ...grantableRoles(myRole)]));

  if (!member) return null;
  const save = async () => {
    setErr(null);
    if (role === "senior" && !linked) return setErr("Choose the linked profile.");
    if (role !== "senior" && role !== "family_admin" && scope !== "all" && !scope.length) return setErr("Select at least one profile.");
    try {
      await update.mutateAsync({
        uid: member.uid, role, seniorScope: scope, linkedSeniorId: role === "senior" ? linked : null,
        ...(until ? { expiresAt: new Date(until).toISOString() } : { clearExpiry: true }),
      });
      toast.success(`Access updated for ${member.displayName}`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Access for ${member.displayName}`} description={member.email}>
      <div className="space-y-5">
        {err && <p role="alert" className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-600">{err}</p>}
        <Field label="Role" hint={ROLE_HELP[role]}>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </NativeSelect>
        </Field>
        {role === "senior" ? (
          <Field label="Linked profile">
            <NativeSelect value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">Select…</option>
              {seniors.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </NativeSelect>
          </Field>
        ) : role !== "family_admin" ? (
          <ScopePicker seniors={seniors.data ?? []} value={scope} onChange={setScope} />
        ) : null}
        <Field label="Access ends (optional)" hint="Leave empty for ongoing access">
          <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={update.isPending}>Save access</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function CareCircle({ hid, myRole, canManage }: { hid: string; myRole: Role; canManage: boolean }) {
  const me = useMe();
  const members = useMembers(hid);
  const seniors = useSeniors(hid);
  const invitations = useInvitations(hid, canManage);
  const remove = useRemoveMember(hid);
  const revoke = useRevokeInvitation(hid);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const names = useMemo(() => new Map(seniors.data?.map((s) => [s.id, s.fullName]) ?? []), [seniors.data]);
  const grantable = grantableRoles(myRole);
  const pending = invitations.data?.filter((i) => i.status === "pending") ?? [];

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl">Members</h2>
          {canManage && <Button onClick={() => setInviteOpen(true)}><UserPlus /> Invite</Button>}
        </div>
        {members.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : !members.data?.length ? (
          <EmptyState icon={Users} title="No members yet" description="Invite family members and caregivers to share the care." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {members.data.map((m) => {
              const isMe = m.uid === me.data?.user.uid;
              const manageable = canManage && !isMe && m.role !== "household_owner" && grantable.includes(m.role);
              return (
                <li key={m.uid} className="flex flex-wrap items-center gap-3 p-4">
                  <Avatar name={m.displayName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.displayName}</span>
                      {isMe && <Badge tone="sage">You</Badge>}
                      {m.status === "suspended" && <Badge tone="warning">Suspended</Badge>}
                    </div>
                    <div className="truncate text-xs text-ink-500">{m.email}</div>
                  </div>
                  <div className="flex flex-col items-start gap-1 text-xs sm:items-end">
                    <Badge tone={m.role === "household_owner" ? "champagne" : m.role.includes("caregiver") ? "info" : "brand"}>{m.roleLabel}</Badge>
                    <span className="text-ink-500">{m.role === "senior" ? `Own profile: ${names.get(m.linkedSeniorId ?? "") ?? "—"}` : scopeLabel(m.seniorScope, names)}</span>
                    {m.expiresAt && <span className="flex items-center gap-1 text-warning-600"><Clock className="size-3" /> Until {formatDateTime(m.expiresAt)}</span>}
                  </div>
                  {manageable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="rounded-lg p-2 hover:bg-sage-100" aria-label={`Manage ${m.displayName}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(m)}>Change role & access</DropdownMenuItem>
                        <DropdownMenuItem className="text-danger-600" onSelect={() => setRemoving(m)}><ShieldOff /> Revoke access</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && (
        <section>
          <h2 className="mb-4 font-display text-xl">Pending invitations</h2>
          {invitations.isLoading ? <Skeleton className="h-16" /> : invitations.isError ? (
            <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
          ) : pending.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 p-4">
                  <Mail className="size-5 text-ink-300" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.email}</div>
                    <div className="text-xs text-ink-500">{i.roleLabel} · invited by {i.invitedByName} · expires {formatDate(i.expiresAt)}</div>
                  </div>
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === i.id}
                    onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.success("Invitation revoked"), onError: (e) => toast.error(errorMessage(e)) })}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canManage && inviteOpen && <InviteDialog hid={hid} myRole={myRole} open={inviteOpen} onOpenChange={setInviteOpen} />}
      {editing && <EditMemberDialog key={editing.uid} hid={hid} member={editing} myRole={myRole} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Revoke access for ${removing?.displayName}?`}
        description="They will immediately lose access to this household and every profile in it. Their past activity stays in the audit log."
        confirmLabel="Revoke access"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.uid, {
          onSuccess: () => { toast.success("Access revoked"); setRemoving(null); },
          onError: (e) => toast.error(errorMessage(e)),
        })}
      />
    </div>
  );
}
