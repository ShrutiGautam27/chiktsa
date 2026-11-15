import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Home, Lock, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENGINES, MODULES, PRINCIPLES, STEPS } from "./content";
import { usePageTitle } from "@/hooks/usePageTitle";

/** Illustrative product preview (static artwork, not live data). */
function HeroPreview() {
  const rows = [
    { name: "Mohan (Grandfather)", house: "Sharma · Delhi", status: "Appointment Thu — escort unassigned", tone: "warn" },
    { name: "Kamla (Grandmother)", house: "Sharma · Delhi", status: "Handover acknowledged by Priya", tone: "ok" },
    { name: "Suresh (Uncle)", house: "Sharma · Delhi", status: "Prescription awaiting verification", tone: "info" },
  ];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-lg">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-100/70 via-transparent to-champagne-100/80 blur-2xl" />
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-lift">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><Home className="size-4 text-brand-600" /> Sharma Family</div>
          <span className="rounded-full bg-champagne-100 px-2.5 py-1 text-xs font-medium text-champagne-700">3 profiles</span>
        </div>
        <div className="mb-4 rounded-2xl bg-brand-700 p-4 text-white">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-brand-100"><Sparkles className="size-3.5" /> Today's care briefing</div>
          <p className="mt-2 text-sm leading-relaxed text-white/90">One appointment has no one assigned to accompany. One prescription is waiting for a family administrator to verify.</p>
        </div>
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 rounded-2xl border border-line p-3">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-sage-100 text-sage-600"><UserRound className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                <div className="truncate text-xs text-ink-500">{r.status}</div>
              </div>
              <span className={r.tone === "warn" ? "size-2.5 rounded-full bg-warning-600" : r.tone === "ok" ? "size-2.5 rounded-full bg-brand-500" : "size-2.5 rounded-full bg-info-600"} />
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-center text-xs text-ink-500">Illustration</p>
    </div>
  );
}

export function Landing() {
  usePageTitle();
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:pt-20">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-champagne-300 bg-champagne-50 px-3 py-1 text-xs font-medium text-champagne-700">
            <Sparkles className="size-3.5" /> Care coordination intelligence
          </span>
          <h1 className="mt-5 font-display text-4xl leading-[1.08] text-ink-900 sm:text-5xl lg:text-6xl">
            One platform.<br />Every generation.<br /><span className="text-brand-700">Connected care.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-500">
            Chiktsa brings seniors, families and caregivers into one secure space — and quietly spots the care
            responsibilities nobody has picked up yet.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link to="/signup">Create your care space <ArrowRight /></Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/how-it-works">See how it works</Link></Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500">
            {["Multiple households", "Per-profile permissions", "Senior-controlled consent"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-brand-500" /> {t}</li>
            ))}
          </ul>
        </div>
        <HeroPreview />
      </section>

      {/* Engines */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-champagne-700">Three intelligence engines</p>
            <h2 className="mt-2 font-display text-3xl text-ink-900 sm:text-4xl">Not another medicine reminder.</h2>
            <p className="mt-3 text-ink-500">A coordination layer that understands what has happened, what is pending, and whether anyone is responsible.</p>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {ENGINES.map((e) => (
              <article key={e.key} className="flex flex-col rounded-3xl border border-line bg-ivory p-7">
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-brand-700 text-champagne-300"><e.icon className="size-5" /></span>
                <h3 className="mt-5 font-display text-xl text-ink-900">{e.name}</h3>
                <p className="mt-1 text-sm text-brand-700">{e.tagline}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-ink-700">
                  {e.points.slice(0, 3).map((p) => (
                    <li key={p} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sage-400" />{p}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Multi-household */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-champagne-700">Built for real families</p>
          <h2 className="mt-2 font-display text-3xl text-ink-900 sm:text-4xl">Grandparents in one city. An uncle in another. A caregiver for both.</h2>
          <p className="mt-4 text-ink-500">
            Each elderly person has an independent profile with their own records, consent and history. One person can
            belong to several households, and a caregiver can be authorised for exactly the profiles they look after.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { h: "Household A", p: ["Grandfather", "Grandmother", "Uncle"] },
            { h: "Household B", p: ["Grandfather", "Grandmother"] },
            { h: "Household C", p: ["One elder"] },
          ].map((h) => (
            <div key={h.h} className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-semibold"><Home className="size-4 text-brand-600" />{h.h}</div>
              <ul className="mt-3 space-y-1.5">
                {h.p.map((x) => <li key={x} className="rounded-lg bg-sage-50 px-2.5 py-1.5 text-xs text-ink-700">{x}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section className="bg-brand-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="max-w-2xl font-display text-3xl sm:text-4xl">AI that powers workflows — not a chatbot with a care label.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.slice(0, 6).map((m) => (
              <div key={m.title} className="bg-brand-800 p-6">
                <m.icon className="size-5 text-champagne-300" />
                <h3 className="mt-4 font-medium">{m.title}</h3>
                <p className="mt-1.5 text-sm text-white/70">{m.body}</p>
              </div>
            ))}
          </div>
          <Button asChild variant="champagne" className="mt-8"><Link to="/features">Explore all features <ArrowRight /></Link></Button>
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="font-display text-3xl text-ink-900 sm:text-4xl">Up and running in minutes</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="font-display text-3xl text-champagne-500">{s.n}</div>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="rounded-3xl border border-line bg-surface p-8 shadow-soft sm:p-12">
          <div className="flex items-center gap-2 text-brand-700"><Lock className="size-5" /><span className="text-sm font-semibold">Privacy and safety principles</span></div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PRINCIPLES.map((p) => (
              <div key={p.title}>
                <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand-500" />{p.title}</h3>
                <p className="mt-1.5 text-sm text-ink-500">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-line pt-8 sm:flex-row sm:items-center">
            <p className="font-display text-xl">Bring your family's care into one place.</p>
            <Button asChild size="lg"><Link to="/signup">Get started free <ArrowRight /></Link></Button>
          </div>
        </div>
      </section>
    </>
  );
}
