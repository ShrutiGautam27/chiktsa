import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { CareContextProvider } from "@/hooks/useCareContext";
import { AppShell } from "@/components/AppShell";
import { PublicLayout } from "@/components/PublicLayout";
import { FullPageSpinner } from "@/components/common";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Landing } from "@/pages/public/Landing";
import { PLANNED } from "@/lib/navigation";

// Route-level code splitting: each area downloads only when first visited.
const named = <T,>(loader: () => Promise<T>, key: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[key] as unknown as React.ComponentType })));

const info = () => import("@/pages/public/InfoPages");
const FeaturesPage = named(info, "FeaturesPage");
const HowItWorksPage = named(info, "HowItWorksPage");
const AboutPage = named(info, "AboutPage");
const ContactPage = named(info, "ContactPage");
const NotFoundPage = named(info, "NotFoundPage");
const auth = () => import("@/pages/auth/AuthPages");
const LoginPage = named(auth, "LoginPage");
const SignupPage = named(auth, "SignupPage");
const DashboardPage = named(() => import("@/pages/app/DashboardPage"), "DashboardPage");
const hh = () => import("@/pages/app/HouseholdPages");
const HouseholdsPage = named(hh, "HouseholdsPage");
const HouseholdDetailPage = named(hh, "HouseholdDetailPage");
const ProfilesPage = named(hh, "ProfilesPage");
const CirclePage = named(hh, "CirclePage");
const ActivityPage = named(hh, "ActivityPage");
const SeniorProfilePage = named(() => import("@/pages/app/SeniorProfilePage"), "SeniorProfilePage");
const SettingsPage = named(() => import("@/pages/app/SettingsPage"), "SettingsPage");
const misc = () => import("@/pages/app/MiscPages");
const AcceptInvitePage = named(misc, "AcceptInvitePage");
const PlannedPage = named(misc, "PlannedPage");
const MedicationsPage = named(() => import("@/pages/app/MedicationsPage"), "MedicationsPage");
const MedicationSafetyPage = named(() => import("@/pages/app/MedicationSafetyPage"), "MedicationSafetyPage");
const AppointmentsPage = named(() => import("@/pages/app/AppointmentsPage"), "AppointmentsPage");
const TasksPage = named(() => import("@/pages/app/TasksPage"), "TasksPage");
const HandoverPage = named(() => import("@/pages/app/HandoverPage"), "HandoverPage");
const ContinuityPage = named(() => import("@/pages/app/ContinuityPage"), "ContinuityPage");
const CoordinationPage = named(() => import("@/pages/app/CoordinationPage"), "CoordinationPage");
const consentMod = () => import("@/pages/app/ConsentPage");
const ConsentPage = named(consentMod, "ConsentPage");
const MemoryPage = named(() => import("@/pages/app/MemoryPage"), "MemoryPage");
const DocumentsPage = named(() => import("@/pages/app/DocumentsPage"), "DocumentsPage");
const emerg = () => import("@/pages/app/EmergencyPage");
const EmergencyPage = named(emerg, "EmergencyPage");
const PublicEmergencyPage = named(emerg, "PublicEmergencyPage");
const p5 = () => import("@/pages/app/WellbeingPages");
const ReportsPage = named(p5, "ReportsPage");
const OrganisationPage = named(p5, "OrganisationPage");
const VoicePage = named(p5, "VoicePage");
const NotificationsPage = named(() => import("@/pages/app/NotificationsPage"), "NotificationsPage");

/** Gate for authenticated areas. Redirects to login with a safe `next` back-link. */
function RequireAuth() {
  const { status, error } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "error") return <FullPageSpinner label={error ?? "Authentication unavailable"} />;
  if (status === "anonymous") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <CareContextProvider>
      <Outlet />
    </CareContextProvider>
  );
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Landing />} />
            <Route path="features" element={<FeaturesPage />} />
            <Route path="how-it-works" element={<HowItWorksPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="contact" element={<ContactPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="emergency/:token" element={<PublicEmergencyPage />} />

          <Route element={<RequireAuth />}>
            <Route path="invite/:token" element={<AcceptInvitePage />} />
            <Route path="app" element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="households" element={<HouseholdsPage />} />
              <Route path="households/:hid" element={<HouseholdDetailPage />} />
              <Route path="households/:hid/profiles/:sid" element={<SeniorProfilePage />} />
              <Route path="profiles" element={<ProfilesPage />} />
              <Route path="circle" element={<CirclePage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="medications" element={<MedicationsPage />} />
              <Route path="medication-safety" element={<MedicationSafetyPage />} />
              <Route path="prescriptions" element={<MedicationSafetyPage />} />
              <Route path="appointments" element={<AppointmentsPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="handover" element={<HandoverPage />} />
              <Route path="continuity" element={<ContinuityPage />} />
              <Route path="coordination" element={<CoordinationPage />} />
              <Route path="consent" element={<ConsentPage />} />
              <Route path="memory" element={<MemoryPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="emergency" element={<EmergencyPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="organisation" element={<OrganisationPage />} />
              <Route path="voice" element={<VoicePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              {PLANNED.map((p) => <Route key={p.to} path={p.to.replace("/app/", "")} element={<PlannedPage />} />)}
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>

          <Route element={<PublicLayout />}>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
