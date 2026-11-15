/** Dialog, ConfirmDialog, Tabs and DropdownMenu built on Radix primitives (shadcn/ui style). */
import type { ComponentProps, ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import * as T from "@radix-ui/react-tabs";
import * as M from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Dialog({ open, onOpenChange, title, description, children, className }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink-900/30 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-lift",
            className,
          )}
        >
          <div className="mb-5 pr-8">
            <D.Title className="font-display text-xl text-ink-900">{title}</D.Title>
            <D.Description className={description ? "mt-1 text-sm text-ink-500" : "sr-only"}>{description ?? title}</D.Description>
          </div>
          {children}
          <D.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-ink-500 hover:bg-sage-100" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, loading, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={destructive ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

export const Tabs = T.Root;
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-sage-100 p-1", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink-500 transition-colors data-[state=active]:bg-surface data-[state=active]:text-ink-900 data-[state=active]:shadow-soft",
        className,
      )}
      {...p}
    />
  );
}
export function TabsContent({ className, ...p }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("mt-5 focus-visible:outline-none", className)} {...p} />;
}

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export function DropdownMenuContent({ className, align = "end", ...p }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className={cn("z-50 min-w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lift", className)} {...p} />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, ...p }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-700 outline-none data-[highlighted]:bg-sage-100 data-[highlighted]:text-ink-900 [&_svg]:size-4", className)}
      {...p}
    />
  );
}
export function DropdownMenuLabel({ className, ...p }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500", className)} {...p} />;
}
export function DropdownMenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}
