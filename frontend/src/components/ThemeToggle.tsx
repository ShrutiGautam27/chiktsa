import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/** Accessible light/dark switch with an animated sun/moon thumb. */
export function ThemeToggle({ className, large }: { className?: string; large?: boolean }) {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-line bg-sage-100 p-0.5 transition-colors hover:border-brand-300",
        large ? "h-11 w-20" : "h-8 w-[3.75rem]",
        className,
      )}
    >
      <Sun aria-hidden className={cn("absolute text-champagne-700", large ? "left-3 size-5" : "left-2 size-3.5")} />
      <Moon aria-hidden className={cn("absolute text-ink-500", large ? "right-3 size-5" : "right-2 size-3.5")} />
      <span
        aria-hidden
        className={cn(
          "relative z-10 inline-flex items-center justify-center rounded-full bg-surface shadow-soft transition-transform duration-300",
          large ? "size-9" : "size-6",
          dark ? (large ? "translate-x-9" : "translate-x-7") : "translate-x-0",
        )}
      >
        {dark ? <Moon className={cn("text-brand-600", large ? "size-5" : "size-3.5")} /> : <Sun className={cn("text-champagne-700", large ? "size-5" : "size-3.5")} />}
      </span>
    </button>
  );
}
