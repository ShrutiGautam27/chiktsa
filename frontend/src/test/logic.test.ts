import { describe, expect, it } from "vitest";
import { safeNext, signupSchema } from "@/pages/auth/AuthPages";
import { seniorSchema } from "@/features/SeniorFormDialog";
import { householdSchema } from "@/features/HouseholdFormDialog";
import { navFor } from "@/lib/navigation";
import { grantableRoles } from "@/lib/types";

describe("safeNext (open-redirect protection)", () => {
  it("allows same-site paths only", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
    expect(safeNext("//evil.com")).toBe("/app");
    expect(safeNext("https://evil.com")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
    expect(safeNext("/\\evil.com")).toBe("/app");          // backslash trick
    expect(safeNext("/%5Cevil.com")).toBe("/%5Cevil.com"); // encoded stays a harmless local path
    expect(safeNext("/\tevil.com")).toBe("/app");          // control characters
    expect(safeNext("/app/tasks?x=1#y")).toBe("/app/tasks?x=1#y");
  });
});

describe("signup validation", () => {
  const ok = { displayName: "Asha", email: "a@example.com", password: "CorrectHorse42", confirm: "CorrectHorse42", locale: "en" as const };
  it("accepts a valid signup", () => expect(signupSchema.safeParse(ok).success).toBe(true));
  it("rejects weak or mismatched passwords", () => {
    expect(signupSchema.safeParse({ ...ok, password: "short1", confirm: "short1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, password: "lettersonlyxx", confirm: "lettersonlyxx" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...ok, confirm: "Different123" }).success).toBe(false);
  });
});

describe("senior profile validation", () => {
  const base = { fullName: "Mohan Sharma", preferredName: "", dateOfBirth: "1946-03-12", gender: "male" as const, primaryLanguage: "hi" as const, notes: "", emergencyContacts: [] };
  it("accepts a valid profile", () => expect(seniorSchema.safeParse(base).success).toBe(true));
  it("rejects future birth dates and bad phone numbers", () => {
    expect(seniorSchema.safeParse({ ...base, dateOfBirth: "2999-01-01" }).success).toBe(false);
    expect(seniorSchema.safeParse({ ...base, emergencyContacts: [{ name: "Priya", relationship: "", phone: "call me" }] }).success).toBe(false);
  });
  it("requires a name", () => expect(seniorSchema.safeParse({ ...base, fullName: "  " }).success).toBe(false));
});

describe("household validation", () => {
  it("requires a name", () => {
    expect(householdSchema.safeParse({ name: "", timezone: "Asia/Kolkata" }).success).toBe(false);
    expect(householdSchema.safeParse({ name: "Sharma Family", timezone: "Asia/Kolkata" }).success).toBe(true);
  });
});

describe("role-specific navigation", () => {
  const labels = (role: Parameters<typeof navFor>[0], perms: string[] = []) =>
    navFor(role, (p) => perms.includes(p)).flatMap((s) => s.items.map((i) => i.label));

  it("seniors get no family navigation (they use Senior Mode)", () => expect(labels("senior")).toEqual([]));
  it("activity log requires audit.read", () => {
    expect(labels("family_member")).not.toContain("Activity log");
    expect(labels("household_owner", ["audit.read"])).toContain("Activity log");
  });
  it("organisation module is available to every non-senior (to create or manage an agency)", () => {
    expect(labels("org_admin")).toContain("Organisation");
    expect(labels("family_admin")).toContain("Organisation");
    expect(labels("senior")).not.toContain("Organisation");
  });
  it("handover is for caregivers and admins", () => {
    expect(labels("primary_caregiver")).toContain("Caregiver handover");
    expect(labels("family_member")).not.toContain("Caregiver handover");
  });
});

describe("grantable roles mirror the backend", () => {
  it("owner can grant admin, admin cannot", () => {
    expect(grantableRoles("household_owner")).toContain("family_admin");
    expect(grantableRoles("family_admin")).not.toContain("family_admin");
    expect(grantableRoles("family_member")).toEqual([]);
    expect(grantableRoles("household_owner")).not.toContain("household_owner");
  });
});
