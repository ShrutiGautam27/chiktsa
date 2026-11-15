import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2, CalendarPlus, Check, Download, Heart, Mic, MicOff, Phone, Send, Siren, Volume2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton, Switch } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { ErrorState } from "@/components/common";
import { useRecordDose } from "@/hooks/care-queries";
import { useMe } from "@/hooks/queries";
import { useCareContext } from "@/hooks/useCareContext";
import { downloadBlob, useCheckIn, useHouseholdOrg, usePreferences, useSavePreferences, useVoice, useWellness, type Preferences, type VoiceReply } from "@/hooks/wellbeing-queries";
import { ApiError, errorMessage } from "@/lib/api";
import { enqueue, isOfflineError } from "@/lib/offline";
import type { Appointment } from "@/lib/care-types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ Senior Mode labels (English / Hindi)
const DICT = {
  en: { talk: "Talk to Chiktsa", listening: "Listening…", typeInstead: "Or type your question", send: "Ask", yesRecord: "Yes, I took it", call: "Call", emergency: "Open emergency card",
        howFeel: "How are you feeling today?", wantCall: "I'd like someone to call me", saveCheckin: "Save", thanks: "Thank you — saved.", myMeds: "My medicines today",
        myAppts: "My appointments", whoSees: "Who can see my care", readAloud: "Read this page aloud", noScreen: "Voice-only mode", noScreenHint: "Chiktsa reads everything aloud and you can just speak." },
  hi: { talk: "Chiktsa से बात करें", listening: "सुन रहे हैं…", typeInstead: "या अपना सवाल लिखें", send: "पूछें", yesRecord: "हाँ, मैंने ले ली", call: "फोन करें", emergency: "आपातकालीन कार्ड खोलें",
        howFeel: "आज आप कैसा महसूस कर रहे हैं?", wantCall: "मुझे कोई फोन करे", saveCheckin: "सहेजें", thanks: "धन्यवाद — सहेज लिया।", myMeds: "आज की मेरी दवाइयाँ",
        myAppts: "मेरे अपॉइंटमेंट", whoSees: "मेरी देखभाल कौन देख सकता है", readAloud: "यह पेज पढ़कर सुनाएँ", noScreen: "केवल आवाज़ मोड", noScreenHint: "Chiktsa सब कुछ पढ़कर सुनाएगा और आप बस बोल सकते हैं।" },
};
export type SeniorKey = keyof (typeof DICT)["en"];
export function useSeniorText() {
  const me = useMe();
  const lang = me.data?.user.locale === "hi" ? "hi" : "en";
  return { t: (k: SeniorKey) => DICT[lang][k], lang: lang as "en" | "hi" };
}

export function speak(text: string, lang: "en" | "hi", rate = 1) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "hi" ? "hi-IN" : "en-IN";
  u.rate = rate;
  window.speechSynthesis.speak(u);
  return true;
}

// ------------------------------------------------------------------ Voice companion
/** Minimal Web Speech API surface (not yet in TypeScript's DOM types). */
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Rec = { start: () => void; stop: () => void; lang: string; interimResults: boolean; onresult: ((e: SpeechResultEvent) => void) | null; onend: (() => void) | null; onerror: ((e: unknown) => void) | null };
type SpeechWindow = Window & { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };

export function VoiceCompanion({ hid, sid, large, autoSpeak = true }: { hid: string; sid: string; large?: boolean; autoSpeak?: boolean }) {
  const { t, lang: uiLang } = useSeniorText();
  const me = useMe();
  const voice = useVoice(hid, sid);
  const record = useRecordDose(hid, sid);
  const navigate = useNavigate();
  const [lang, setLang] = useState<"en" | "hi">(uiLang);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [reply, setReply] = useState<VoiceReply | null>(null);
  const recRef = useRef<Rec | null>(null);
  const SR = typeof window !== "undefined" ? ((window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition ?? null) : null;
  const rate = me.data?.user.accessibility.voiceRate ?? 1;

  const ask = (q: string) => {
    if (!q.trim()) return;
    voice.mutate({ text: q.trim(), lang }, {
      onSuccess: (r) => { setReply(r); setText(""); if (autoSpeak) speak(r.reply, r.lang, rate); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  const listen = () => {
    if (!SR) return toast.error("Speech recognition isn't available in this browser — please type instead.");
    if (listening) { recRef.current?.stop(); return; }
    const rec: Rec = new SR();
    rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => { const said = e.results[0][0].transcript; setText(said); ask(said); };
    rec.onend = () => setListening(false);
    rec.onerror = () => { setListening(false); toast.error("I didn't catch that — please try again or type."); };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  useEffect(() => () => recRef.current?.stop(), []);

  const a = reply?.action;
  const confirmDose = () => a?.medicationId && record.mutate({ medicationId: a.medicationId, scheduledFor: a.scheduledFor!, status: "taken" }, {
    onSuccess: () => { toast.success(t("thanks")); setReply(null); },
    onError: (e) => {
      if (!isOfflineError(e)) return toast.error(errorMessage(e));
      enqueue({ type: "dose.record", householdId: hid, seniorId: sid, label: `${a.label} dose`, payload: { medicationId: a.medicationId, scheduledFor: a.scheduledFor, status: "taken" } });
      toast.info("Saved on this device — it will sync when you're back online."); setReply(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size={large ? "xl" : "lg"} onClick={listen} variant={listening ? "danger" : "primary"} aria-pressed={listening} className={cn(large && "w-full sm:w-auto")}>
          {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />} {listening ? t("listening") : t("talk")}
        </Button>
        <div role="radiogroup" aria-label="Language" className="inline-flex rounded-xl bg-sage-100 p-1">
          {(["en", "hi"] as const).map((l) => <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)}
            className={cn("rounded-lg px-3 py-1.5 text-sm", lang === l ? "bg-surface font-medium shadow-soft" : "text-ink-500")}>{l === "en" ? "English" : "हिन्दी"}</button>)}
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("typeInstead")} aria-label={t("typeInstead")} className={cn(large && "h-14 text-lg")} maxLength={500} />
        <Button type="submit" size={large ? "xl" : "md"} loading={voice.isPending} disabled={!text.trim()} aria-label={t("send")}><Send aria-hidden /></Button>
      </form>
      {reply && (
        <div className={cn("rounded-2xl border-2 border-brand-200 bg-brand-50 p-5", large && "text-xl")} aria-live="polite">
          <p className="flex items-start gap-3"><Volume2 className="mt-1 size-5 shrink-0 text-brand-700" aria-hidden /><span>{reply.reply}</span></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" size={large ? "lg" : "sm"} onClick={() => speak(reply.reply, reply.lang, rate)}><Volume2 aria-hidden /> Repeat</Button>
            {a?.type === "record_dose" && <Button size={large ? "xl" : "md"} onClick={confirmDose} loading={record.isPending}><Check aria-hidden /> {t("yesRecord")}</Button>}
            {a?.type === "call" && a.phone && <Button asChild size={large ? "xl" : "md"}><a href={`tel:${a.phone}`}><Phone aria-hidden /> {t("call")} {a.label}</a></Button>}
            {a?.type === "emergency" && <>
              <Button size={large ? "xl" : "md"} variant="danger" onClick={() => navigate("/app/emergency")}><Siren aria-hidden /> {t("emergency")}</Button>
              {a.phone && <Button asChild size={large ? "xl" : "md"} variant="outline"><a href={`tel:${a.phone}`}><Phone aria-hidden /> {a.label}</a></Button>}
              <Button asChild size={large ? "xl" : "md"} variant="outline"><a href="tel:112"><Phone aria-hidden /> 112</a></Button>
            </>}
            {a?.type === "navigate" && a.to && <Button size={large ? "xl" : "md"} variant="secondary" onClick={() => navigate(a.to!)}>Open</Button>}
          </div>
        </div>
      )}
      {!SR && <p className="text-xs text-ink-500">Voice input uses your browser's speech recognition, which isn't available here. Typing works everywhere. (Google Cloud Speech is a pending integration.)</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Wellness check-in
const FACES = ["😣", "🙁", "😐", "🙂", "😄"];

export function WellnessCheckIn({ hid, sid, large }: { hid: string; sid: string; large?: boolean }) {
  const { t } = useSeniorText();
  const save = useCheckIn(hid, sid);
  const [mood, setMood] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [wantsCall, setWantsCall] = useState(false);
  const submit = () => mood && save.mutate({ mood, ...(sleep ? { sleep } : {}), wantsCall }, {
    onSuccess: () => { toast.success(t("thanks")); setMood(null); setSleep(null); setWantsCall(false); },
    onError: (e) => {
      if (!isOfflineError(e)) return toast.error(errorMessage(e));
      enqueue({ type: "wellness.checkin", householdId: hid, seniorId: sid, label: "Check-in", payload: { mood, ...(sleep ? { sleep } : {}), wantsCall } });
      toast.info("Saved on this device — it will sync when you're back online.");
    },
  });
  const scale = (value: number | null, set: (n: number) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {FACES.map((f, i) => (
        <button key={i} role="radio" aria-checked={value === i + 1} aria-label={`${label} ${i + 1} of 5`} onClick={() => set(i + 1)}
          className={cn("rounded-2xl border-2 transition-colors", large ? "size-16 text-4xl" : "size-11 text-2xl", value === i + 1 ? "border-brand-500 bg-brand-50" : "border-line hover:bg-sage-50")}>{f}</button>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className={cn("font-semibold", large ? "text-2xl" : "text-sm")}>{t("howFeel")}</p>
      {scale(mood, setMood, "Mood")}
      {!large && <><p className="text-sm text-ink-700">Sleep last night (optional)</p>{scale(sleep, setSleep, "Sleep")}</>}
      <label className={cn("flex items-center gap-3", large ? "text-xl" : "text-sm")}><Switch checked={wantsCall} onCheckedChange={setWantsCall} aria-label={t("wantCall")} /> {t("wantCall")}</label>
      <Button size={large ? "xl" : "md"} disabled={!mood} loading={save.isPending} onClick={submit}><Heart aria-hidden /> {t("saveCheckin")}</Button>
      <p className="text-xs text-ink-500">Voluntary and self-reported. It's never used to diagnose anything.</p>
    </div>
  );
}

export function WellnessTrend({ hid, sid }: { hid: string; sid: string }) {
  const w = useWellness(hid, sid);
  if (w.isError && w.error instanceof ApiError && w.error.status === 403) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Wellness check-ins</CardTitle><CardDescription>{w.data?.note ?? "Self-reported, voluntary"}</CardDescription></CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <WellnessCheckIn hid={hid} sid={sid} />
        <div>
          {w.isLoading ? <Skeleton className="h-40" /> : !w.data?.entries.length ? <p className="text-sm text-ink-500">No check-ins in the last 30 days.</p> : (
            <>
              <p className="mb-2 text-sm text-ink-700">Average mood {w.data.averages.mood ?? "—"} / 5 over {w.data.entries.length} check-in(s)</p>
              <div className="h-40" role="img" aria-label="Self-reported mood over time">
                <ResponsiveContainer>
                  <BarChart data={w.data.entries.map((e) => ({ day: e.date.slice(5), mood: e.mood }))}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-500)", fontSize: 11 }} />
                    <YAxis domain={[0, 5]} allowDecimals={false} tickLine={false} axisLine={false} width={20} tick={{ fill: "var(--color-ink-500)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 12 }} labelStyle={{ color: "var(--color-ink-900)" }} itemStyle={{ color: "var(--color-ink-900)" }} />
                    <Bar dataKey="mood" name="Mood (1–5)" fill="var(--color-brand-500)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-ink-500">{w.data.entries.slice(-3).reverse().map((e) => (
                <li key={e.date}>{e.date} · {FACES[e.mood - 1]} {e.note && `“${e.note}”`} {e.wantsCall && <Badge tone="warning">asked for a call</Badge>} · {e.reportedBy === "self" ? "self-reported" : `by ${e.recordedByName}`}</li>))}</ul>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Personal wishes
const WISH_FIELDS: [keyof Preferences, string, boolean][] = [
  ["preferredLanguage", "Preferred language", false], ["communicationStyle", "How I like to be spoken to", true], ["dailyRoutine", "My daily routine", true],
  ["foodPreferences", "Food preferences", true], ["faithAndCulture", "Faith & culture", true], ["likes", "Things I enjoy", true],
  ["dislikes", "Things I'd rather avoid", true], ["careWishes", "My care wishes", true], ["trustedContactsNote", "About my trusted contacts", true],
];

export function WishesCard({ hid, sid, name }: { hid: string; sid: string; name: string }) {
  const p = usePreferences(hid, sid);
  const save = useSavePreferences(hid, sid);
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<Partial<Preferences>>({});
  if (p.isError && p.error instanceof ApiError && p.error.status === 403) return null;
  if (p.isLoading) return <Skeleton className="h-40" />;
  if (p.isError) return <ErrorState error={p.error} />;
  const d = p.data!;
  const filled = WISH_FIELDS.filter(([k]) => d[k]);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>Personal wishes & preferences</CardTitle><CardDescription>In {name}'s own words — so everyone cares for them the way they'd like.</CardDescription></div>
        {d.canEdit && !edit && <Button size="sm" variant="outline" onClick={() => { setV(d); setEdit(true); }}>Edit</Button>}
      </CardHeader>
      <CardContent>
        {edit ? (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault();
            save.mutate(Object.fromEntries(WISH_FIELDS.map(([k]) => [k, (v[k] as string) ?? ""])), { onSuccess: () => { toast.success("Saved"); setEdit(false); }, onError: (er) => toast.error(errorMessage(er)) }); }}>
            {WISH_FIELDS.map(([k, label, long]) => (
              <Field key={k} label={label} className={long ? "sm:col-span-2" : ""}>
                {long ? <Textarea rows={2} value={(v[k] as string) ?? ""} maxLength={1500} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
                  : <Input value={(v[k] as string) ?? ""} maxLength={60} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
              </Field>
            ))}
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEdit(false)}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
          </form>
        ) : filled.length ? (
          <dl className="grid gap-4 sm:grid-cols-2">{filled.map(([k, label]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap text-sm">{d[k] as string}</dd></div>)}</dl>
        ) : <p className="text-sm text-ink-500">Nothing recorded yet.{d.canEdit && " Add routines, likes and care wishes so every caregiver knows."}</p>}
        {d.updatedByName && !edit && <p className="mt-4 text-xs text-ink-500">Last updated by {d.updatedByName}</p>}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Organisation connection (household side)
export function ConnectOrgCard({ hid }: { hid: string }) {
  const act = useHouseholdOrg(hid);
  const { can } = useCareContext();
  const [code, setCode] = useState("");
  if (!can("members.manage")) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4 text-brand-600" /> Professional care organisation</CardTitle>
        <CardDescription>Connect an agency using the code they give you. Their administrators join as organisation admins; they can then place their caregivers on specific profiles. You can disconnect at any time, which removes all their access.</CardDescription></CardHeader>
      <CardContent>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault();
          act.mutate({ action: "connect", code }, { onSuccess: (r) => { toast.success(`Connected ${(r as { name: string }).name}`); setCode(""); }, onError: (er) => toast.error(errorMessage(er)) }); }}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Organisation code" aria-label="Organisation code" maxLength={32} />
          <Button type="submit" disabled={code.length < 4} loading={act.isPending}>Connect</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Calendar export
export function CalendarButtons({ hid, appt }: { hid: string; appt: Appointment }) {
  const start = new Date(appt.startsAt);
  const end = new Date(start.getTime() + appt.durationMinutes * 60000);
  const g = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${appt.title} — ${appt.seniorName}`)}&dates=${g(start)}/${g(end)}&location=${encodeURIComponent(appt.location || "")}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" onClick={() => downloadBlob(`/households/${hid}/seniors/${appt.seniorId}/appointments/${appt.id}/ics`, "appointment.ics").catch((e) => toast.error(errorMessage(e)))}><Download /> .ics</Button>
      <Button asChild size="sm" variant="ghost"><a href={gcal} target="_blank" rel="noopener noreferrer"><CalendarPlus /> Google Calendar</a></Button>
    </div>
  );
}

export { Link };
