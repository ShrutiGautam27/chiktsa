import {
  Activity, ArrowRightLeft, Brain, CalendarCheck, FileLock2, HeartHandshake, Mic, ScanLine, ShieldCheck, Siren, Users,
  WifiOff, Scale, Globe2, type LucideIcon,
} from "lucide-react";

export interface Engine {
  key: string;
  name: string;
  tagline: string;
  icon: LucideIcon;
  points: string[];
}

export const ENGINES: Engine[] = [
  {
    key: "continuity",
    name: "Care Continuity Intelligence",
    tagline: "Notices what nobody has picked up yet.",
    icon: Activity,
    points: [
      "Invisible Care Gap Detector flags unassigned appointments, medication checks and unacknowledged instructions",
      "Caregiver Handover Passport with completed, pending and outstanding items",
      "Absence Protocol finds authorised backups and requests acceptance",
      "Change Detective shows what changed, when, by whom, and who approved it",
      "What-If Simulator for planning around absences, delays and stock-outs",
    ],
  },
  {
    key: "medication",
    name: "Medication Safety Intelligence",
    tagline: "Nothing becomes a schedule until a person verifies it.",
    icon: ShieldCheck,
    points: [
      "Prescription Confusion Firewall: OCR, structured extraction and ambiguity highlighting",
      "Unclear handwriting and missing fields block activation until verified",
      "Refill intelligence projects depletion dates from recorded stock",
      "Medication Journey Timeline from upload to every dose confirmation",
      "Never invents names or doses, never changes a prescription",
    ],
  },
  {
    key: "family",
    name: "Family Coordination Intelligence",
    tagline: "Everyone knows what's theirs — fairly.",
    icon: Users,
    points: [
      "Family Care Circle with invitations, roles and per-profile access",
      "Workload view highlights imbalance and suggests fairer distribution",
      "Universal Care Switcher across households, profiles and roles",
      "Consent Expiry Manager: seniors grant, limit, time-box and revoke access",
      "Time-zone aware reminders for family members abroad",
    ],
  },
];

export const MODULES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Brain, title: "AI Care Memory Bridge", body: "Ask about past visits and notes. Answers cite the original records — and say so when information is missing." },
  { icon: CalendarCheck, title: "Appointment preparation", body: "A visit summary built from verified medications, previous notes and the senior's own questions." },
  { icon: Mic, title: "Voice-first companion", body: "Spoken questions in English and Hindi, read-aloud answers and a no-screen mode." },
  { icon: ScanLine, title: "Prescription ambiguity detector", body: "Uncertain or conflicting fields are highlighted and kept inactive until a person confirms them." },
  { icon: ArrowRightLeft, title: "Workload balancer", body: "Spots caregivers with too many pending responsibilities and proposes reassignments." },
  { icon: WifiOff, title: "Internet independence", body: "Essential schedules cached offline; changes sync safely with conflict handling." },
  { icon: Siren, title: "Emergency snapshot", body: "A senior-approved, limited-access card with trusted contacts and verified information." },
  { icon: FileLock2, title: "Secure document vault", body: "Prescriptions, reports and summaries with per-profile access control." },
  { icon: HeartHandshake, title: "Personal wishes", body: "Preferred language, communication style, trusted contacts and care preferences — in the senior's words." },
  { icon: Scale, title: "Fair contribution view", body: "Tasks accepted, completed and pending — a workload view, never a ranking of people." },
  { icon: Globe2, title: "Time-zone coordinator", body: "Appointments and reminders shown in each family member's local time." },
];

export const STEPS = [
  { n: "01", title: "Create a household", body: "Start a private care space. You can create or join as many households as your family needs." },
  { n: "02", title: "Add each elderly person", body: "Every senior gets an independent profile — their own records, preferences, consent and history." },
  { n: "03", title: "Invite the care circle", body: "Invite family and caregivers by email with a role and access to specific profiles, optionally time-limited." },
  { n: "04", title: "Coordinate with intelligence", body: "Chiktsa surfaces gaps, handovers and workload so responsibilities never fall through the cracks." },
];

export const PRINCIPLES = [
  { title: "Senior-controlled", body: "Seniors decide who sees what, and can revoke access at any time." },
  { title: "Isolated by design", body: "Every household is a separate tenant. Every request is authorised on the server." },
  { title: "Verified before active", body: "AI proposes; people confirm. Nothing clinical is activated without human verification." },
  { title: "Never diagnoses", body: "Chiktsa coordinates care. Clinical questions are escalated to qualified professionals." },
];
