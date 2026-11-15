import { cloneElement, useId, type ReactElement } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

/** Label + control + hint/error with correct aria wiring. */
export function Field({ label, error, hint, children, className }: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <LabelPrimitive.Root htmlFor={id} className="text-sm font-medium text-ink-700">
        {label}
      </LabelPrimitive.Root>
      {cloneElement(children, { id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
