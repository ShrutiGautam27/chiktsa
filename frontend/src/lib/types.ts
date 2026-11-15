export type Role =
  | "household_owner"
  | "family_admin"
  | "family_member"
  | "primary_caregiver"
  | "secondary_caregiver"
  | "org_admin"
  | "senior";

export type SeniorScope = "all" | string[];

export interface Accessibility {
  fontScale: number;
  highContrast: boolean;
  simplifiedNav: boolean;
  voiceRate: number;
  reduceMotion: boolean;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: "en" | "hi";
  platformRole: string;
  accessibility: Accessibility;
}

export interface MembershipSummary {
  householdId: string;
  householdName: string;
  role: Role;
  roleLabel: string;
  seniorScope: SeniorScope;
  linkedSeniorId: string | null;
  permissions: string[];
}

export interface Me {
  user: User;
  memberships: MembershipSummary[];
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
  seniorCount: number;
  memberCount: number;
  myRole: Role | null;
  createdAt: string | null;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface Senior {
  id: string;
  householdId: string;
  fullName: string;
  preferredName: string;
  dateOfBirth: string | null;
  gender: "female" | "male" | "other" | "undisclosed";
  primaryLanguage: "en" | "hi";
  timezone: string | null;
  notes: string;
  emergencyContacts: EmergencyContact[];
  status: "active" | "archived";
  age: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Member {
  uid: string;
  householdId: string;
  displayName: string;
  email: string;
  role: Role;
  roleLabel: string;
  status: string;
  seniorScope: SeniorScope;
  linkedSeniorId: string | null;
  expiresAt: string | null;
  joinedAt: string | null;
}

export interface Invitation {
  id: string;
  token: string | null;
  householdId: string;
  householdName: string;
  email: string;
  role: Role;
  roleLabel: string;
  seniorScope: SeniorScope;
  linkedSeniorId: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  seniorId: string | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  at: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  household_owner: "Household owner",
  family_admin: "Family administrator",
  family_member: "Family member",
  primary_caregiver: "Primary caregiver",
  secondary_caregiver: "Secondary caregiver",
  org_admin: "Organisation administrator",
  senior: "Senior",
};

/** Roles a member of the given role may grant — mirrors backend GRANTABLE_BY. */
export function grantableRoles(role: Role | null | undefined): Role[] {
  if (role === "household_owner")
    return ["family_admin", "family_member", "primary_caregiver", "secondary_caregiver", "org_admin", "senior"];
  if (role === "family_admin")
    return ["family_member", "primary_caregiver", "secondary_caregiver", "org_admin", "senior"];
  return [];
}
