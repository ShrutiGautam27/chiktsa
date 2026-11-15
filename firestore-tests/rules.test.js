/**
 * Firestore security-rules tests (run against the local emulator):
 *   npm test   (wraps `firebase emulators:exec --only firestore`)
 *
 * Proves that users cannot read other households' records or elderly profiles outside their
 * scope (including subcollections), and that clients can never write directly.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-carehub",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const future = Timestamp.fromMillis(Date.now() + 86400000);
    const past = Timestamp.fromMillis(Date.now() - 60000);
    const m = (uid, hid, role, extra = {}) => ({ uid, householdId: hid, role, status: "active", seniorScope: "all", ...extra });
    // Household A: owner, scoped caregiver (s1 only), senior linked to s2, revoked member, expired member
    await setDoc(doc(db, "households/hA"), { name: "A" });
    await setDoc(doc(db, "households/hA/members/owner"), m("owner", "hA", "household_owner"));
    await setDoc(doc(db, "households/hA/members/carer"), m("carer", "hA", "primary_caregiver", { seniorScope: ["s1"] }));
    await setDoc(doc(db, "households/hA/members/grandma"), m("grandma", "hA", "senior", { seniorScope: ["s2"], linkedSeniorId: "s2" }));
    await setDoc(doc(db, "households/hA/members/gone"), m("gone", "hA", "family_member", { status: "revoked" }));
    await setDoc(doc(db, "households/hA/members/temp"), m("temp", "hA", "family_member", { expiresAt: past }));
    await setDoc(doc(db, "households/hA/members/tempok"), m("tempok", "hA", "family_member", { expiresAt: future }));
    await setDoc(doc(db, "households/hA/seniors/s1"), { fullName: "S1" });
    await setDoc(doc(db, "households/hA/seniors/s2"), { fullName: "S2" });
    await setDoc(doc(db, "households/hA/seniors/s1/medications/m1"), { name: "verified med" });
    await setDoc(doc(db, "households/hA/seniors/s2/medications/m2"), { name: "verified med" });
    await setDoc(doc(db, "households/hA/tasks/t1"), { seniorId: "s2", title: "Escort to appointment" });
    await setDoc(doc(db, "households/hA/auditLogs/a1"), { action: "x" });
    // Household B: different owner; the carer also works here (Scenario C)
    await setDoc(doc(db, "households/hB"), { name: "B" });
    await setDoc(doc(db, "households/hB/members/ownerB"), m("ownerB", "hB", "household_owner"));
    await setDoc(doc(db, "households/hB/members/carer"), m("carer", "hB", "secondary_caregiver"));
    await setDoc(doc(db, "households/hB/seniors/b1"), { fullName: "B1" });
    await setDoc(doc(db, "households/hB/seniors/b1/medications/mb"), { name: "verified med" });
    await setDoc(doc(db, "users/owner"), { email: "o@example.com" });
    await setDoc(doc(db, "authCredentials/owner"), { passwordHash: "x" });
    await setDoc(doc(db, "invitations/abc"), { householdId: "hA" });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const read = (uid, path) => getDoc(doc(uid ? as(uid) : env.unauthenticatedContext().firestore(), path));

describe("tenant isolation (Scenario F)", () => {
  it("owner of A cannot read household B or its subcollections", async () => {
    await assertFails(read("owner", "households/hB"));
    await assertFails(read("owner", "households/hB/seniors/b1"));
    await assertFails(read("owner", "households/hB/seniors/b1/medications/mb"));
    await assertFails(read("owner", "households/hB/members/ownerB"));
  });
  it("unauthenticated users can read nothing", async () => {
    await assertFails(read(null, "households/hA"));
    await assertFails(read(null, "households/hA/seniors/s1"));
    await assertFails(read(null, "users/owner"));
  });
  it("members read their own household and in-scope profiles", async () => {
    await assertSucceeds(read("owner", "households/hA"));
    await assertSucceeds(read("owner", "households/hA/seniors/s2"));
  });
  it("medical subcollections are server-only (consent is enforced by the API)", async () => {
    await assertFails(read("owner", "households/hA/seniors/s2/medications/m2"));
    await assertFails(read("carer", "households/hA/seniors/s1/medications/m1"));
  });
});

describe("profile scope", () => {
  it("scoped caregiver sees only assigned profile, including subcollections", async () => {
    await assertSucceeds(read("carer", "households/hA/seniors/s1"));
    await assertFails(read("carer", "households/hA/seniors/s2"));
    await assertFails(read("carer", "households/hA/seniors/s2/medications/m2"));
    await assertFails(read("carer", "households/hA/tasks/t1")); // task for out-of-scope senior
  });
  it("caregiver serving two households reads both (Scenario C)", async () => {
    await assertSucceeds(read("carer", "households/hB/seniors/b1"));
  });
  it("senior sees only their own profile", async () => {
    await assertSucceeds(read("grandma", "households/hA/seniors/s2"));
    await assertFails(read("grandma", "households/hA/tasks/t1")); // tasks are API-only
    await assertFails(read("grandma", "households/hA/seniors/s1"));
  });
});

describe("revocation and expiry", () => {
  it("revoked member is denied", async () => {
    await assertFails(read("gone", "households/hA"));
    await assertFails(read("gone", "households/hA/seniors/s1"));
  });
  it("expired temporary access is denied, unexpired allowed", async () => {
    await assertFails(read("temp", "households/hA/seniors/s1"));
    await assertSucceeds(read("tempok", "households/hA/seniors/s1"));
  });
});

describe("server-only data and writes", () => {
  it("credentials, invitations and audit logs are never client-readable", async () => {
    await assertFails(read("owner", "authCredentials/owner"));
    await assertFails(read("owner", "invitations/abc"));
    await assertFails(read("owner", "households/hA/auditLogs/a1"));
  });
  it("users read only their own profile", async () => {
    await assertSucceeds(read("owner", "users/owner"));
    await assertFails(read("carer", "users/owner"));
  });
  it("clients cannot write anything directly, even the owner", async () => {
    await assertFails(setDoc(doc(as("owner"), "households/hA"), { name: "x" }));
    await assertFails(setDoc(doc(as("owner"), "households/hA/members/owner"), { role: "household_owner" }));
    await assertFails(setDoc(doc(as("owner"), "households/hA/seniors/s1/medications/new"), { name: "x" }));
    await assertFails(setDoc(doc(as("carer"), "households/hA/members/carer"), { seniorScope: "all" })); // self-escalation
    await assertFails(setDoc(doc(as("owner"), "users/owner"), { platformRole: "platform_admin" }));
  });
});
