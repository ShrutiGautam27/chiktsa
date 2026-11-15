import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useSaveSenior } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Senior } from "@/lib/types";

const today = new Date().toISOString().slice(0, 10);

export const seniorSchema = z.object({
  fullName: z.string().trim().min(1, "Enter the full name").max(120),
  preferredName: z.string().trim().max(60),
  dateOfBirth: z
    .string()
    .refine((v) => !v || (v >= "1900-01-01" && v <= today), "Enter a valid date of birth"),
  gender: z.enum(["female", "male", "other", "undisclosed"]),
  primaryLanguage: z.enum(["en", "hi"]),
  notes: z.string().max(2000, "Keep notes under 2000 characters"),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name required").max(120),
        relationship: z.string().trim().max(60),
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a valid phone number"),
      }),
    )
    .max(10),
});
export type SeniorValues = z.infer<typeof seniorSchema>;

const empty: SeniorValues = { fullName: "", preferredName: "", dateOfBirth: "", gender: "undisclosed", primaryLanguage: "en", notes: "", emergencyContacts: [] };

export function SeniorFormDialog({ open, onOpenChange, householdId, senior }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  householdId: string;
  senior?: Senior;
}) {
  const save = useSaveSenior(householdId, senior?.id);
  const form = useForm<SeniorValues>({ resolver: zodResolver(seniorSchema), defaultValues: empty });
  const contacts = useFieldArray({ control: form.control, name: "emergencyContacts" });

  useEffect(() => {
    if (!open) return;
    form.reset(
      senior
        ? {
            fullName: senior.fullName, preferredName: senior.preferredName, dateOfBirth: senior.dateOfBirth ?? "",
            gender: senior.gender, primaryLanguage: senior.primaryLanguage, notes: senior.notes,
            emergencyContacts: senior.emergencyContacts,
          }
        : empty,
    );
  }, [open, senior]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    try {
      const s = await save.mutateAsync({ ...v, dateOfBirth: v.dateOfBirth || null });
      toast.success(senior ? "Profile updated" : `Profile for ${s.fullName} created`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  const e = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl"
      title={senior ? `Edit ${senior.fullName}` : "Add an elderly profile"}
      description="Each profile keeps its own records, preferences, consent and history — never mixed with anyone else's.">
      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" error={e.fullName?.message}><Input autoFocus {...form.register("fullName")} /></Field>
          <Field label="Preferred name" hint="What they like to be called" error={e.preferredName?.message}><Input {...form.register("preferredName")} /></Field>
          <Field label="Date of birth" error={e.dateOfBirth?.message}><Input type="date" max={today} {...form.register("dateOfBirth")} /></Field>
          <Field label="Gender">
            <NativeSelect {...form.register("gender")}>
              <option value="undisclosed">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </NativeSelect>
          </Field>
          <Field label="Primary language">
            <NativeSelect {...form.register("primaryLanguage")}>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </NativeSelect>
          </Field>
        </div>
        <Field label="Care notes" hint="Non-clinical notes such as routines or preferences" error={e.notes?.message}>
          <Textarea rows={3} {...form.register("notes")} />
        </Field>

        <fieldset className="space-y-3">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium text-ink-700">Trusted contacts</legend>
            <Button type="button" size="sm" variant="ghost" disabled={contacts.fields.length >= 10}
              onClick={() => contacts.append({ name: "", relationship: "", phone: "" })}>
              <Plus /> Add contact
            </Button>
          </div>
          {contacts.fields.length === 0 && <p className="text-sm text-ink-500">No contacts yet.</p>}
          {contacts.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Field label="Name" error={e.emergencyContacts?.[i]?.name?.message}><Input {...form.register(`emergencyContacts.${i}.name`)} /></Field>
              <Field label="Relationship"><Input {...form.register(`emergencyContacts.${i}.relationship`)} /></Field>
              <Field label="Phone" error={e.emergencyContacts?.[i]?.phone?.message}><Input type="tel" {...form.register(`emergencyContacts.${i}.phone`)} /></Field>
              <Button type="button" variant="ghost" size="icon" className="self-end" onClick={() => contacts.remove(i)} aria-label={`Remove contact ${i + 1}`}><Trash2 /></Button>
            </div>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={form.formState.isSubmitting}>{senior ? "Save changes" : "Create profile"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
