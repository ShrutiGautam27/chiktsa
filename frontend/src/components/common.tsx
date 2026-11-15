import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { BRAND } from "@/lib/brand";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <Link to="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label={`${BRAND.full} home`}>
      <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-700 shadow-soft">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <path d="M16 24s-7-4.3-7-9.6A3.9 3.9 0 0 1 16 12a3.9 3.9 0 0 1 7 2.4C23 19.7 16 24 16 24z" fill="none" stroke="#E8D5AE" strokeWidth="2.2" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={cn("font-display text-xl font-medium", light ? "text-white" : "text-ink-900")}>
        {BRAND.name}{BRAND.suffix && <> <span className={light ? "text-champagne-300" : "text-brand-600"}>{BRAND.suffix}</span></>}
      </span>
    </Link>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-champagne-700">{eyebrow}</div>}
        <h1 className="font-display text-2xl text-ink-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-500 sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-sage-200 bg-sage-50/60 px-6 py-12 text-center", className)}>
      <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-surface text-brand-600 shadow-soft">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-lg text-ink-900">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-2xl border border-danger-600/20 bg-danger-50 px-6 py-10 text-center", className)}>
      <AlertTriangle className="mb-3 size-6 text-danger-600" aria-hidden />
      <p className="font-medium text-ink-900">We couldn't load this</p>
      <p className="mt-1 text-sm text-ink-700">{errorMessage(error)}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, hint, tone = "brand" }: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: string;
  tone?: "brand" | "champagne" | "sage";
}) {
  const tones = { brand: "bg-brand-50 text-brand-700", champagne: "bg-champagne-100 text-champagne-700", sage: "bg-sage-100 text-sage-600" };
  return (
    <div className="card-surface rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-500">{label}</span>
        <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      <div className="mt-3 font-display text-3xl text-ink-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

export function FullPageSpinner({ label = `Loading ${BRAND.name}…` }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-3 border-brand-100 border-t-brand-600" />
        <p className="text-sm text-ink-500">{label}</p>
      </div>
    </div>
  );
}
