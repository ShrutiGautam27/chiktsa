import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Menu, Settings, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe } from "@/hooks/queries";
import { navFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { CareSwitcher } from "./CareSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { OfflineBanner } from "./OfflineBanner";
import { DemoBanner } from "./DemoBanner";
import { Logo } from "./common";
import { Avatar, Skeleton } from "./ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/overlay";
import { lazy } from "react";
const SeniorShell = lazy(() => import("./SeniorShell").then((m) => ({ default: m.SeniorShell })));

/** Applies the user's accessibility preferences (font scale, contrast, motion) to the document. */
export function useApplyAccessibility() {
  const me = useMe();
  const a = me.data?.user.accessibility;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font-scale", String(a?.fontScale ?? 1));
    root.dataset.contrast = a?.highContrast ? "high" : "normal";
    root.dataset.motion = a?.reduceMotion ? "reduce" : "normal";
    root.lang = me.data?.user.locale ?? "en";
    return () => {
      root.style.setProperty("--app-font-scale", "1");
      root.dataset.contrast = "normal";
    };
  }, [a?.fontScale, a?.highContrast, a?.reduceMotion, me.data?.user.locale]);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, can } = useCareContext();
  const me = useMe();
  const simplified = me.data?.user.accessibility.simplifiedNav;
  const sections = navFor(role, can)
    .map((s) => ({ ...s, items: simplified ? s.items.filter((i) => !i.phase) : s.items }))
    .filter((s) => s.items.length);

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{section.title}</div>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/app"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                      isActive ? "bg-brand-700 text-white shadow-soft" : "text-ink-700 hover:bg-sage-100",
                      item.phase && !isActive && "text-ink-500",
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.phase && (
                    <span className="rounded-md bg-champagne-100 px-1.5 py-0.5 text-[10px] font-semibold text-champagne-700" title={`Planned for phase ${item.phase}`}>
                      P{item.phase}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const name = me.data?.user.displayName ?? "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-0.5 hover:bg-sage-100" aria-label="Account menu">
        <Avatar name={name || "?"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block text-sm font-semibold text-ink-900">{name}</span>
          <span className="block text-xs font-normal text-ink-500">{me.data?.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/app/settings")}><Settings /> Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={async () => { await logout(); navigate("/login"); }}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  useApplyAccessibility();
  const { role } = useCareContext();
  const [open, setOpen] = useState(false);
  // The mobile navigation drawer closes with Escape, like any dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  if (role === "senior") return <Suspense fallback={<div className="min-h-screen bg-ivory" />}><SeniorShell /></Suspense>;

  return (
    <div className="min-h-screen bg-ivory">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-ivory px-3 py-5 lg:flex">
        <div className="mb-7 px-2"><Logo /></div>
        <div className="flex-1 overflow-y-auto pb-6"><Sidebar /></div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" tabIndex={-1} aria-label="Close menu" className="absolute inset-0 cursor-default bg-ink-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ivory px-3 py-5 shadow-lift">
            <div className="mb-5 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-sage-100" aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <div className="mb-5 px-1"><CareSwitcher compact /></div>
            <div className="flex-1 overflow-y-auto"><Sidebar onNavigate={() => setOpen(false)} /></div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-ivory/85 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-sage-100 lg:hidden" aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="hidden min-w-0 sm:block"><CareSwitcher /></div>
          <div className="ml-auto flex items-center gap-2"><ThemeToggle /><NotificationBell /><UserMenu /></div>
        </header>
        <DemoBanner />
        <OfflineBanner />
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
          <Suspense fallback={<div className="space-y-4" role="status" aria-label="Loading"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
