import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Monitor, Moon, Sun, Volume2 } from "lucide-react";
import { useTheme, type ThemePref } from "@/hooks/useTheme";
import { essentialsEnabled, setEssentials } from "@/lib/offline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton, Switch } from "@/components/ui/misc";
import { ErrorState, PageHeader } from "@/components/common";
import { useMe, useUpdateMe } from "@/hooks/queries";
import { errorMessage } from "@/lib/api";
import type { Accessibility } from "@/lib/types";
import { TIMEZONES } from "@/lib/utils";

const FONT_SCALES = [
  { v: 1, label: "Standard" },
  { v: 1.125, label: "Large" },
  { v: 1.25, label: "Larger" },
  { v: 1.5, label: "Extra large" },
];

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-3 hover:bg-sage-50">
      <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-ink-500">{description}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function AppearanceCard() {
  const { pref, setPref } = useTheme();
  const options: { v: ThemePref; label: string; icon: typeof Sun }[] = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
    { v: "system", label: "Match device", icon: Monitor },
  ];
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Appearance</CardTitle><CardDescription>Choose a colour theme for this device.</CardDescription></CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Colour theme" className="grid gap-2 sm:grid-cols-3">
          {options.map((o) => (
            <button key={o.v} type="button" role="radio" aria-checked={pref === o.v} onClick={() => setPref(o.v)}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${pref === o.v ? "border-brand-500 bg-brand-50 font-medium" : "border-line hover:bg-sage-50"}`}>
              <o.icon className="size-5 text-brand-600" aria-hidden /> {o.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OfflineCard() {
  const [on, setOn] = useState(essentialsEnabled());
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Internet independence</CardTitle><CardDescription>Keep today's schedule, profiles, appointments and emergency cards readable on this device when the internet drops. Changes you make offline are saved here and synced automatically.</CardDescription></CardHeader>
      <CardContent>
        <ToggleRow label="Keep essentials available offline on this device" description="Only turn this on for a device you trust — the information is stored in this browser until you sign out."
          checked={on} onChange={(v) => { setEssentials(v); setOn(v); toast.success(v ? "Essentials will be kept offline" : "Offline copy removed from this device"); }} />
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const me = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("");
  const [locale, setLocale] = useState<"en" | "hi">("en");

  useEffect(() => {
    if (me.data) {
      setName(me.data.user.displayName);
      setTz(me.data.user.timezone);
      setLocale(me.data.user.locale);
    }
  }, [me.data]);

  if (me.isLoading) return <Skeleton className="h-96" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const a = me.data!.user.accessibility;

  const saveA11y = (patch: Partial<Accessibility>) =>
    update.mutate({ accessibility: patch }, { onSuccess: () => toast.success("Preference saved"), onError: (e) => toast.error(errorMessage(e)) });

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Name can't be empty");
    update.mutate({ displayName: name.trim(), timezone: tz, locale }, { onSuccess: () => toast.success("Profile saved"), onError: (err) => toast.error(errorMessage(err)) });
  };

  const testVoice = () => {
    if (!("speechSynthesis" in window)) return toast.error("Read-aloud isn't supported in this browser");
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(locale === "hi" ? "नमस्ते, यह आपकी आवाज़ की गति है।" : "Hello. This is how fast I will read to you.");
    u.rate = a.voiceRate;
    u.lang = locale === "hi" ? "hi-IN" : "en-IN";
    window.speechSynthesis.speak(u);
  };

  return (
    <>
      <PageHeader title="Settings" description="Your profile and accessibility preferences apply on every device you sign in to." />
      <div className="grid gap-6 lg:grid-cols-2">
        <AppearanceCard />
        <OfflineCard />
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{me.data!.user.email}</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="space-y-5" noValidate>
              <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
              <Field label="Your time zone" hint="Appointments and reminders are shown in this zone.">
                <NativeSelect value={tz} onChange={(e) => setTz(e.target.value)}>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Language">
                <NativeSelect value={locale} onChange={(e) => setLocale(e.target.value as "en" | "hi")}>
                  <option value="en">English</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                </NativeSelect>
              </Field>
              <Button type="submit" loading={update.isPending}>Save profile</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Accessibility</CardTitle><CardDescription>Make CareHub comfortable to read and use.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-700">Text size</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {FONT_SCALES.map((f) => (
                  <button key={f.v} type="button" onClick={() => saveA11y({ fontScale: f.v })} aria-pressed={a.fontScale === f.v}
                    className={`rounded-xl border px-3 py-3 text-center transition-colors ${a.fontScale === f.v ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line hover:bg-sage-50"}`}>
                    <span className="block font-display" style={{ fontSize: `${f.v * 1.1}rem` }}>Aa</span>
                    <span className="text-xs">{f.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="-mx-3">
              <ToggleRow label="High contrast" description="Stronger text and borders" checked={a.highContrast} onChange={(v) => saveA11y({ highContrast: v })} />
              <ToggleRow label="Simplified navigation" description="Show only modules that are ready to use" checked={a.simplifiedNav} onChange={(v) => saveA11y({ simplifiedNav: v })} />
              <ToggleRow label="Reduce motion" description="Turn off animations" checked={a.reduceMotion} onChange={(v) => saveA11y({ reduceMotion: v })} />
            </div>
            <Field label={`Read-aloud speed: ${a.voiceRate.toFixed(2)}×`}>
              <input type="range" min={0.5} max={1.5} step={0.05} defaultValue={a.voiceRate} className="w-full accent-brand-600"
                onPointerUp={(e) => saveA11y({ voiceRate: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => saveA11y({ voiceRate: Number((e.target as HTMLInputElement).value) })} />
            </Field>
            <Button variant="secondary" onClick={testVoice}><Volume2 /> Test read-aloud</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
