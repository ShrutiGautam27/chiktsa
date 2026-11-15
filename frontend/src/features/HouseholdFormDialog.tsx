import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useCreateHousehold, useUpdateHousehold } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { errorMessage } from "@/lib/api";
import type { Household } from "@/lib/types";
import { TIMEZONES, browserTimeZone } from "@/lib/utils";

export const householdSchema = z.object({
  name: z.string().trim().min(1, "Give the household a name").max(120, "Keep it under 120 characters"),
  timezone: z.string().min(1),
});
type Values = z.infer<typeof householdSchema>;

export function HouseholdFormDialog({ open, onOpenChange, household, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  household?: Household;
  onCreated?: (h: Household) => void;
}) {
  const create = useCreateHousehold();
  const update = useUpdateHousehold(household?.id ?? "");
  const { setHousehold } = useCareContext();
  const form = useForm<Values>({ resolver: zodResolver(householdSchema), defaultValues: { name: "", timezone: browserTimeZone() } });

  useEffect(() => {
    if (open) form.reset({ name: household?.name ?? "", timezone: household?.timezone ?? browserTimeZone() });
  }, [open, household]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    try {
      if (household) {
        await update.mutateAsync(v);
        toast.success("Household updated");
      } else {
        const h = await create.mutateAsync(v);
        setHousehold(h.id);
        toast.success(`“${h.name}” created — you're the owner`);
        onCreated?.(h);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={household ? "Edit household" : "Create a household"}
      description={household ? undefined : "A household is a private care space. You can add several elderly profiles to it and invite your care circle."}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label="Household name" error={form.formState.errors.name?.message} hint="For example “Sharma Family — Delhi”">
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field label="Household time zone" hint="Used for schedules. Each family member still sees times in their own zone.">
          <NativeSelect {...form.register("timezone")}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </NativeSelect>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={form.formState.isSubmitting}>{household ? "Save changes" : "Create household"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
