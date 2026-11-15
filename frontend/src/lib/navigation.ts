/**
 * Role-specific navigation. Modules not yet built are listed with the phase they are planned for,
 * rendered as clearly labelled "Planned" items that open an honest status page (never a fake screen).
 */
import {
  Activity, Bell, Brain, CalendarDays, ClipboardList, FileLock2, HeartHandshake, Home, LayoutDashboard, LifeBuoy,
  Mic, Pill, Scale, Settings, ShieldCheck, Siren, Users, UserRound, ArrowRightLeft, BarChart3, Building2,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see this item. Undefined = every non-senior role. */
  roles?: Role[];
  permission?: string;
  /** If set, the module is planned for this build phase and not yet implemented. */
  phase?: number;
  description?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const FAMILY: Role[] = ["household_owner", "family_admin", "family_member"];
const CAREGIVERS: Role[] = ["primary_caregiver", "secondary_caregiver"];
const ADMINS: Role[] = ["household_owner", "family_admin"];

export const NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { to: "/app", label: "Dashboard", icon: LayoutDashboard },
      { to: "/app/households", label: "Households", icon: Home },
      { to: "/app/profiles", label: "Elderly profiles", icon: UserRound },
      { to: "/app/circle", label: "Family Care Circle", icon: Users },
      { to: "/app/coordination", label: "Family Coordination", icon: Scale },
    ],
  },
  {
    title: "Daily care",
    items: [
      { to: "/app/medications", label: "Medications", icon: Pill },
      { to: "/app/appointments", label: "Appointments", icon: CalendarDays },
      { to: "/app/tasks", label: "Responsibility Centre", icon: ClipboardList },
      { to: "/app/handover", label: "Caregiver handover", icon: ArrowRightLeft, roles: [...CAREGIVERS, ...ADMINS] },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { to: "/app/continuity", label: "Care Continuity", icon: Activity },
      { to: "/app/medication-safety", label: "Medication Safety", icon: ShieldCheck },
      { to: "/app/memory", label: "AI Care Memory", icon: Brain },
      { to: "/app/voice", label: "Voice Companion", icon: Mic },
    ],
  },
  {
    title: "Records & safety",
    items: [
      { to: "/app/documents", label: "Document Vault", icon: FileLock2 },
      { to: "/app/reports", label: "Reports & analytics", icon: BarChart3, roles: [...FAMILY, "org_admin"] },
      { to: "/app/emergency", label: "Emergency Snapshot", icon: Siren },
      { to: "/app/consent", label: "Consent & permissions", icon: HeartHandshake },
      { to: "/app/activity", label: "Activity log", icon: LifeBuoy, permission: "audit.read" },
    ],
  },
  {
    title: "Organisation",
    items: [
      { to: "/app/organisation", label: "Organisation", icon: Building2 },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/app/notifications", label: "Notifications", icon: Bell },
      { to: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function navFor(role: Role | null, can: (p: string) => boolean): NavSection[] {
  return NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      if (role === "senior") return false; // seniors use the simplified Senior Mode
      if (i.roles && (!role || !i.roles.includes(role))) return false;
      if (i.permission && !can(i.permission)) return false;
      return true;
    }),
  })).filter((s) => s.items.length > 0);
}

export const PLANNED: NavItem[] = NAV.flatMap((s) => s.items).filter((i) => i.phase);
