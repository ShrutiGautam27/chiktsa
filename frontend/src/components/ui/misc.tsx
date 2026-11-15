/** Small primitives: Badge, Skeleton, Avatar, Switch. */
import type { ComponentProps, HTMLAttributes } from "react";
import * as S from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, initials } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      brand: "bg-brand-50 text-brand-700",
      sage: "bg-sage-100 text-sage-600",
      champagne: "bg-champagne-100 text-champagne-700",
      neutral: "bg-ivory-deep text-ink-700",
      danger: "bg-danger-50 text-danger-600",
      warning: "bg-warning-50 text-warning-600",
      info: "bg-info-50 text-info-600",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-sage-100", className)} />;
}

const tones = ["bg-brand-100 text-brand-800", "bg-champagne-100 text-champagne-700", "bg-sage-100 text-sage-600", "bg-info-50 text-info-600"];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const tone = tones[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];
  return (
    <span aria-hidden className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", tone, className)}>
      {initials(name) || "?"}
    </span>
  );
}

export function Switch({ className, ...p }: ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn("relative h-6 w-11 shrink-0 rounded-full bg-ink-300 transition-colors data-[state=checked]:bg-brand-600", className)}
      {...p}
    >
      <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}
