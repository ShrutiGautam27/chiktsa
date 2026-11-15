/**
 * Universal Care Switcher — move between households, roles and elderly profiles.
 * Each household's data is fetched under its own tenant-scoped query; nothing is merged.
 */
import { Check, ChevronsUpDown, Home, Plus, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCareContext } from "@/hooks/useCareContext";
import { useSeniors } from "@/hooks/queries";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/overlay";
import { cn } from "@/lib/utils";

export function CareSwitcher({ compact }: { compact?: boolean }) {
  const { memberships, membership, householdId, seniorId, setHousehold, setSenior } = useCareContext();
  const seniors = useSeniors(householdId ?? undefined);
  const navigate = useNavigate();
  const senior = seniors.data?.find((s) => s.id === seniorId);

  if (!memberships.length) {
    return (
      <button onClick={() => navigate("/app/households?new=1")} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-sage-400 px-3 py-2 text-sm text-brand-700 hover:bg-sage-50">
        <Plus className="size-4" /> Create a household
      </button>
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", compact && "flex-col items-stretch")}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-soft hover:bg-ivory-deep"
          aria-label="Switch household"
        >
          <Home className="size-4 shrink-0 text-brand-600" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink-900">{membership?.householdName ?? "Choose household"}</span>
            <span className="block truncate text-xs text-ink-500">{membership?.roleLabel}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-ink-300" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Your households</DropdownMenuLabel>
          {memberships.map((m) => (
            <DropdownMenuItem key={m.householdId} onSelect={() => setHousehold(m.householdId)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.householdName}</span>
                <span className="block text-xs text-ink-500">{m.roleLabel}</span>
              </span>
              {m.householdId === householdId && <Check className="text-brand-600" aria-label="Selected" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/app/households?new=1")}>
            <Plus /> New household
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-soft hover:bg-ivory-deep"
          aria-label="Switch elderly profile"
        >
          <UserRound className="size-4 shrink-0 text-champagne-700" aria-hidden />
          <span className="truncate text-sm font-medium text-ink-900">{senior ? senior.preferredName || senior.fullName : "All profiles"}</span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-ink-300" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Elderly profiles</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setSenior(null)}>
            <span className="flex-1">All profiles (household overview)</span>
            {!seniorId && <Check className="text-brand-600" />}
          </DropdownMenuItem>
          {seniors.data?.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => setSenior(s.id)}>
              <span className="flex-1 truncate">{s.fullName}</span>
              {s.id === seniorId && <Check className="text-brand-600" />}
            </DropdownMenuItem>
          ))}
          {seniors.data?.length === 0 && <p className="px-2.5 py-2 text-sm text-ink-500">No profiles yet.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
