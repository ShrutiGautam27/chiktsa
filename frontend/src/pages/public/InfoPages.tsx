import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ENGINES, MODULES, PRINCIPLES, STEPS } from "./content";
import { usePageTitle } from "@/hooks/usePageTitle";

function Hero({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  usePageTitle(eyebrow);
  return (
    <section className="mx-auto max-w-4xl px-4 pb-10 pt-14 text-center sm:px-6 sm:pt-20">
      <p className="text-xs font-semibold uppercase tracking-wider text-champagne-700">{eyebrow}</p>
      <h1 className="mt-3 font-display text-4xl text-ink-900 sm:text-5xl">{title}</h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-500">{body}</p>
    </section>
  );
}

export function FeaturesPage() {
  return (
    <>
      <Hero eyebrow="Features" title="Everything a care circle needs" body="Three intelligence engines and a set of original modules that turn scattered care into coordinated care." />
      <section className="mx-auto max-w-6xl space-y-6 px-4 pb-16 sm:px-6">
        {ENGINES.map((e) => (
          <article key={e.key} className="grid gap-6 rounded-3xl border border-line bg-surface p-7 shadow-soft md:grid-cols-[1fr_1.4fr] md:p-10">
            <div>
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-700 text-champagne-300"><e.icon className="size-6" /></span>
              <h2 className="mt-5 font-display text-2xl">{e.name}</h2>
              <p className="mt-2 text-brand-700">{e.tagline}</p>
            </div>
            <ul className="space-y-3">
              {e.points.map((p) => <li key={p} className="flex gap-2.5 text-ink-700"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-500" />{p}</li>)}
            </ul>
          </article>
        ))}
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 className="font-display text-3xl">Original care modules</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.title} className="rounded-2xl border border-line bg-surface p-6">
              <m.icon className="size-5 text-brand-600" />
              <h3 className="mt-3 font-semibold">{m.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{m.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function HowItWorksPage() {
  return (
    <>
      <Hero eyebrow="How it works" title="From scattered care to a connected circle" body="CareHub is organised around households, elderly profiles and the people who care for them." />
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <ol className="relative space-y-8 border-l-2 border-sage-200 pl-8">
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span className="absolute -left-[3.05rem] flex size-10 items-center justify-center rounded-full bg-brand-700 font-display text-sm text-champagne-300">{s.n}</span>
              <h2 className="font-display text-2xl">{s.title}</h2>
              <p className="mt-1.5 text-ink-500">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { t: "For families", b: "Detailed dashboards, coordination, reports, notifications and permission controls." },
            { t: "For caregivers", b: "Assigned tasks, medication confirmation, handovers and daily observations — for every household you serve." },
            { t: "For seniors", b: "Large text, large buttons, voice support and full control over who can see your care." },
          ].map((x) => (
            <div key={x.t} className="rounded-3xl border border-line bg-surface p-7 shadow-soft">
              <h3 className="font-display text-xl">{x.t}</h3>
              <p className="mt-2 text-sm text-ink-500">{x.b}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center"><Button asChild size="lg"><Link to="/signup">Create your household <ArrowRight /></Link></Button></div>
      </section>
    </>
  );
}

export function AboutPage() {
  return (
    <>
      <Hero eyebrow="About" title="Care is a team effort. It deserves team tools." body="CareHub AI was created for families who share the care of the people who once cared for them." />
      <section className="mx-auto max-w-3xl space-y-6 px-4 pb-16 text-ink-700 sm:px-6">
        <p>Elderly care is rarely one person's job. It is a grandmother's medicines, a grandfather's appointments, a caregiver's shift change and a cousin abroad who wants to help. Most of the failures in that system are not dramatic — they are small gaps: nobody was assigned, a handover was missed, an instruction was never acknowledged.</p>
        <p>CareHub AI is coordination infrastructure for that reality. It keeps every elderly person's records separate and senior-controlled, connects every household that shares their care, and uses AI carefully — to surface gaps and prepare summaries, never to diagnose or change a prescription.</p>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="rounded-2xl border border-line bg-surface p-6">
              <ShieldCheck className="size-5 text-brand-600" />
              <h3 className="mt-3 font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-ink-500">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const CONTACT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? "";

export function ContactPage() {
  return (
    <>
      <Hero eyebrow="Contact" title="We'd love to hear from you" body="Questions about CareHub for your family or your care organisation?" />
      <section className="mx-auto max-w-xl px-4 pb-20 sm:px-6">
        <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
          <Mail className="mx-auto size-8 text-brand-600" />
          {CONTACT_EMAIL ? (
            <>
              <p className="mt-4 text-ink-700">Email the CareHub team and we'll reply within two working days.</p>
              <Button asChild className="mt-6"><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></Button>
            </>
          ) : (
            <p className="mt-4 text-ink-700">
              A contact address has not been configured for this deployment yet. Set <code className="rounded bg-sage-100 px-1">VITE_CONTACT_EMAIL</code> to enable it.
            </p>
          )}
          <p className="mt-6 text-xs text-ink-500">Please don't send medical records or personal health information by email.</p>
        </div>
      </section>
    </>
  );
}

export function NotFoundPage() {
  usePageTitle("Page not found");
  return (
    <section className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="font-display text-6xl text-champagne-500">404</p>
      <h1 className="mt-4 font-display text-2xl">This page doesn't exist</h1>
      <Button asChild className="mt-6"><Link to="/">Back to home</Link></Button>
    </section>
  );
}
