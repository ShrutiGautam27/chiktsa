import { Suspense, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Logo } from "./common";
import { ThemeToggle } from "./ThemeToggle";
import { DemoBanner } from "./DemoBanner";
import { Button } from "./ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const links = [
  { to: "/features", label: "Features" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export function PublicLayout() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">Skip to content</a>
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ivory/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Public" className="hidden flex-1 items-center gap-1 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => cn("rounded-lg px-3 py-2 text-sm text-ink-700 hover:text-ink-900", isActive && "font-medium text-brand-700")}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle className="ml-auto lg:order-last lg:ml-0" />
          <div className="hidden items-center gap-2 lg:ml-auto lg:flex">
            {status === "authenticated" ? (
              <Button asChild><Link to="/app">Open dashboard</Link></Button>
            ) : (
              <>
                <Button asChild variant="ghost"><Link to="/login">Sign in</Link></Button>
                <Button asChild><Link to="/signup">Get started</Link></Button>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <nav aria-label="Public mobile" className="flex flex-col gap-1 border-t border-line px-4 py-3 lg:hidden">
            {links.map((l) => (
              <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-ink-700 hover:bg-sage-100">{l.label}</Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="outline"><Link to="/login">Sign in</Link></Button>
              <Button asChild><Link to="/signup">Get started</Link></Button>
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1"><Suspense fallback={<div className="min-h-[60vh]" role="status" aria-label="Loading" />}><Outlet /></Suspense></main>
      <footer className="border-t border-line bg-ivory-deep/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-ink-500">One Platform. Every Generation. Connected Care.</p>
            <p className="mt-4 max-w-md text-xs text-ink-500">
              CareHub AI supports care coordination. It does not diagnose, prescribe or replace advice from a qualified healthcare professional.
            </p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold">Product</h4>
            <ul className="space-y-2 text-sm text-ink-500">
              <li><Link to="/features" className="hover:text-ink-900">Features</Link></li>
              <li><Link to="/how-it-works" className="hover:text-ink-900">How it works</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold">Company</h4>
            <ul className="space-y-2 text-sm text-ink-500">
              <li><Link to="/about" className="hover:text-ink-900">About</Link></li>
              <li><Link to="/contact" className="hover:text-ink-900">Contact</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
