/**
 * Senior Mode — substantially simpler interface: large type, large targets, minimal navigation,
 * read-aloud support (browser speech synthesis; Google Text-to-Speech is a pending integration).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, HeartHandshake, LogOut, Phone, Pill, Settings2, Siren, Volume2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCareContext } from "@/hooks/useCareContext";
import { useMe, useSenior } from "@/hooks/queries";
import { greeting } from "@/lib/utils";
import { Button } from "./ui/button";
import { Logo } from "./common";
import { ThemeToggle } from "./ThemeToggle";
import { SettingsPage } from "@/pages/app/SettingsPage";
import { TodayDoses } from "@/features/care/TodayDoses";
import { ConsentPage } from "@/pages/app/ConsentPage";
import { useAppointments } from "@/hooks/care-queries";
import { Switch } from "./ui/misc";
import { OfflineBanner } from "./OfflineBanner";
import { EmergencyPage } from "@/pages/app/EmergencyPage";
import { VoiceCompanion, WellnessCheckIn, speak, useSeniorText } from "@/features/wellbeing/components";

function SeniorAppointments({ hid, sid }: { hid: string; sid: string }) {
  const { t, lang } = useSeniorText();
  const appts = useAppointments(hid, sid);
  const upcoming = (appts.data ?? []).filter((a) => a.status === "scheduled").slice(0, 3);
  return (
    <section aria-labelledby="appts" className="space-y-4">
      <h2 id="appts" className="flex items-center gap-3 text-2xl font-semibold"><CalendarDays className="size-7 text-brand-700" aria-hidden /> {t("myAppts")}</h2>
      {appts.isError ? <p className="text-lg text-ink-500">Appointments aren't available right now.</p> : !upcoming.length ? <p className="text-xl text-ink-500">No upcoming appointments.</p> : (
        <ul className="space-y-3">{upcoming.map((a) => (
          <li key={a.id} className="rounded-2xl border-2 border-line bg-surface p-5">
            <p className="text-xl font-semibold">{a.title}</p>
            <p className="text-lg text-ink-700">{new Date(a.startsAt).toLocaleString(lang === "hi" ? "hi-IN" : undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</p>
            <p className="text-base text-ink-500">{a.escortName ? `${a.escortName} will go with you` : "Your family is arranging who goes with you"}</p>
          </li>))}</ul>
      )}
    </section>
  );
}

const NOSCREEN = "carehub.noScreen";

function SeniorHome() {
  const me = useMe();
  const { t, lang } = useSeniorText();
  const { householdId, membership } = useCareContext();
  const senior = useSenior(householdId ?? undefined, membership?.linkedSeniorId ?? undefined);
  const [params] = useSearchParams();
  const name = senior.data?.preferredName || senior.data?.fullName || me.data?.user.displayName || "";
  const rate = me.data?.user.accessibility.voiceRate ?? 1;
  const [noScreen, setNoScreen] = useState(() => { try { return localStorage.getItem(NOSCREEN) === "on"; } catch { return false; } });
  const intro = useMemo(() => lang === "hi"
    ? `नमस्ते ${name}। आप अपनी दवाइयों, अपॉइंटमेंट या परिवार को फोन करने के बारे में बोलकर पूछ सकते हैं।`
    : `${greeting()}, ${name}. You can ask me about your medicines, your appointments, or say "call" and a name.`, [name, lang]);
  // No-Screen Care Mode: read the page aloud as soon as it opens.
  useEffect(() => { if (noScreen && name) speak(intro, lang, rate); }, [noScreen, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleNoScreen = (v: boolean) => { setNoScreen(v); try { localStorage.setItem(NOSCREEN, v ? "on" : "off"); } catch { /* ignore */ } };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xl text-ink-500">{greeting()},</p>
        <h1 className="font-display text-4xl text-ink-900 sm:text-5xl">{name}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="xl" variant="secondary" onClick={() => speak(intro, lang, rate)}><Volume2 aria-hidden /> {t("readAloud")}</Button>
        <label className="flex items-center gap-3 rounded-2xl border-2 border-line px-4 py-3 text-lg"><Switch checked={noScreen} onCheckedChange={toggleNoScreen} aria-label={t("noScreen")} />{t("noScreen")}</label>
      </div>
      {noScreen && <p className="text-lg text-ink-500">{t("noScreenHint")}</p>}
      {householdId && senior.data && (
        <section aria-label={t("talk")} className="rounded-3xl border-2 border-brand-200 bg-surface p-6">
          <VoiceCompanion hid={householdId} sid={senior.data.id} large />
        </section>
      )}
      {!noScreen && householdId && senior.data && (
        <>
          <section aria-labelledby="meds" className="space-y-4">
            <h2 id="meds" className="flex items-center gap-3 text-2xl font-semibold"><Pill className="size-7 text-brand-700" aria-hidden /> {t("myMeds")}</h2>
            <TodayDoses hid={householdId} senior={senior.data} large />
          </section>
          <section id="checkin" className={`rounded-3xl border-2 p-6 ${params.get("checkin") ? "border-brand-500" : "border-line"} bg-surface`}>
            <WellnessCheckIn hid={householdId} sid={senior.data.id} large />
          </section>
          <SeniorAppointments hid={householdId} sid={senior.data.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Link to="/app/consent" className="flex items-center gap-4 rounded-3xl border-2 border-line bg-surface p-6 text-xl hover:bg-ivory-deep">
              <HeartHandshake className="size-8 text-brand-700" aria-hidden /><span className="flex-1 font-semibold">{t("whoSees")}</span>
            </Link>
            <Link to="/app/emergency" className="flex items-center gap-4 rounded-3xl border-2 border-danger-600/40 bg-surface p-6 text-xl hover:bg-ivory-deep">
              <Siren className="size-8 text-danger-600" aria-hidden /><span className="flex-1 font-semibold">{t("emergency")}</span>
            </Link>
          </div>
        </>
      )}
      {senior.data?.emergencyContacts?.length ? (
        <section aria-labelledby="contacts" className="rounded-3xl border-2 border-champagne-300 bg-champagne-50 p-6">
          <h2 id="contacts" className="mb-4 text-2xl font-semibold">{lang === "hi" ? "मेरे भरोसेमंद संपर्क" : "My trusted contacts"}</h2>
          <ul className="space-y-3">
            {senior.data.emergencyContacts.map((c) => (
              <li key={c.phone}>
                <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-4 rounded-2xl bg-surface p-4 text-xl hover:bg-ivory-deep">
                  <Phone className="size-7 text-brand-700" aria-hidden />
                  <span className="flex-1"><span className="font-semibold">{c.name}</span>{c.relationship && <span className="text-ink-500"> · {c.relationship}</span>}</span>
                  <span className="text-lg text-brand-700">{t("call")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function SeniorShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-ivory text-lg">
      <header className="flex items-center justify-between border-b-2 border-line bg-surface px-4 py-4 sm:px-8">
        <Logo />
        <nav aria-label="Senior" className="flex items-center gap-2">
          <ThemeToggle large />
          <Button asChild variant="outline" size="lg"><Link to="/app/settings" aria-label="Text size"><Settings2 aria-hidden /> <span className="hidden sm:inline">Text size</span></Link></Button>
          <Button variant="ghost" size="lg" aria-label="Sign out" onClick={async () => { await logout(); navigate("/login"); }}><LogOut aria-hidden /> <span className="hidden sm:inline">Sign out</span></Button>
        </nav>
      </header>
      <OfflineBanner />
      <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        {pathname.startsWith("/app/settings") ? <SettingsPage /> : pathname.startsWith("/app/consent") ? <ConsentPage /> : pathname.startsWith("/app/emergency") ? <EmergencyPage /> : <SeniorHome />}
      </main>
    </div>
  );
}
