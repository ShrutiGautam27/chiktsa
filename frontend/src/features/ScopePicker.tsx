/** Choose which elderly profiles a member can access ("all" or specific ones). */
import type { Senior, SeniorScope } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ScopePicker({ seniors, value, onChange, error }: {
  seniors: Senior[];
  value: SeniorScope;
  onChange: (v: SeniorScope) => void;
  error?: string;
}) {
  const all = value === "all";
  const selected = all ? [] : value;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-ink-700">Profile access</legend>
      <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm", all ? "border-brand-500 bg-brand-50" : "border-line")}>
        <input type="radio" name="scope" aria-label="All profiles" checked={all} onChange={() => onChange("all")} className="accent-brand-600" />
        <span><span className="font-medium">All profiles</span><span className="block text-xs text-ink-500">Including profiles added later</span></span>
      </label>
      <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm", !all ? "border-brand-500 bg-brand-50" : "border-line")}>
        <input type="radio" name="scope" aria-label="Only specific profiles" checked={!all} onChange={() => onChange([])} className="accent-brand-600" disabled={!seniors.length} />
        <span><span className="font-medium">Only specific profiles</span>{!seniors.length && <span className="block text-xs text-ink-500">Add a profile first</span>}</span>
      </label>
      {!all && (
        <div className="ml-7 grid gap-1.5 sm:grid-cols-2">
          {seniors.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sage-50">
              <input type="checkbox" aria-label={s.fullName} checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="size-4 accent-brand-600" />
              {s.fullName}
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger-600">{error}</p>}
    </fieldset>
  );
}
