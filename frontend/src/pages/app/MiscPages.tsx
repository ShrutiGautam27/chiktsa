import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Construction, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ErrorState, Logo, PageHeader } from "@/components/common";
import { useAcceptInvitation } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { api, errorMessage } from "@/lib/api";
import { PLANNED } from "@/lib/navigation";
import type { Invitation } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/** Honest status page for modules not yet implemented — no fake data, no dead buttons. */
export function PlannedPage() {
  const { pathname } = useLocation();
  const item = PLANNED.find((i) => i.to === pathname);
  return (
    <>
      <PageHeader eyebrow={item ? `Planned · Phase ${item.phase}` : "Planned"} title={item?.label ?? "Coming soon"} />
      <Card className="flex flex-col items-center p-10 text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-champagne-100 text-champagne-700"><Construction className="size-7" /></span>
        <p className="mt-5 max-w-lg text-ink-700">{item?.description}</p>
        <p className="mt-3 max-w-lg text-sm text-ink-500">
          This module is scheduled for build phase {item?.phase}. It isn't available yet, so nothing on this page is simulated.
        </p>
        <Button asChild variant="outline" className="mt-6"><Link to="/app">Back to dashboard</Link></Button>
      </Card>
    </>
  );
}

/** /invite/:token — preview and accept an invitation (requires sign-in with the invited email). */
export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { setHousehold } = useCareContext();
  const accept = useAcceptInvitation();
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.get<Invitation>(`/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        {preview.isLoading ? <Skeleton className="h-56" /> : preview.isError ? (
          <ErrorState error={preview.error} className="bg-surface" />
        ) : (
          <Card className="p-8 text-center">
            <Mail className="mx-auto size-8 text-brand-600" />
            <h1 className="mt-4 font-display text-2xl">Join {preview.data!.householdName}</h1>
            <p className="mt-2 text-ink-500"><strong className="text-ink-900">{preview.data!.invitedByName}</strong> invited you as <strong className="text-ink-900">{preview.data!.roleLabel}</strong>.</p>
            {preview.data!.status !== "pending" ? (
              <p className="mt-6 rounded-xl bg-warning-50 p-3 text-sm text-warning-600">This invitation is {preview.data!.status}.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-500">Expires {formatDate(preview.data!.expiresAt)}</p>
                <Button size="lg" className="mt-6 w-full" loading={accept.isPending}
                  onClick={() => accept.mutate({ token }, {
                    onSuccess: (r) => { setHousehold(r.householdId); toast.success(`Welcome to ${preview.data!.householdName}`); navigate("/app", { replace: true }); },
                    onError: (e) => toast.error(errorMessage(e)),
                  })}>
                  Accept and join
                </Button>
              </>
            )}
            <Button asChild variant="link" className="mt-3"><Link to="/app">Go to dashboard</Link></Button>
          </Card>
        )}
      </div>
    </div>
  );
}
