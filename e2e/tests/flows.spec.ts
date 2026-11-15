/**
 * Real user journeys through the running app (fresh API + seeded data, see playwright.config.ts).
 */
import { expect, test } from "@playwright/test";
import { expectHealthy, login, watch } from "./helpers";

test.describe.configure({ mode: "serial" });

test("new family: sign up → household → profile → medication → verify → record dose offline → sync (Scenario G)", async ({ page, context }) => {
  const problems = watch(page);
  const email = `e2e.${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Meena Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("TestFamily2026");
  await page.getByLabel("Confirm password").fill("TestFamily2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/households\?new=1/);

  await page.getByLabel("Household name").fill("Test Family");
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: "Test Family" })).toBeVisible();

  await page.goto("/app/profiles");
  await page.getByRole("button", { name: "Add profile" }).first().click();
  await page.getByLabel("Full name").fill("Raghav Test");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByText("Raghav Test").first()).toBeVisible();

  // A dose due 30 minutes ago (in this browser's time zone, which the household inherited at sign-up).
  const due = await page.evaluate(() => {
    const d = new Date(Date.now() - 30 * 60_000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  await page.goto("/app/medications");
  await page.getByRole("button", { name: "Add medication" }).first().click();
  await page.getByLabel("Medicine name").fill("Metformin");
  await page.getByLabel("Strength").fill("500 mg");
  await page.getByLabel("New dose time").fill(due);
  await page.getByRole("button", { name: "Add time" }).click();
  await page.getByRole("button", { name: "Save for verification" }).click();
  await expect(page.getByText("Awaiting verification").first()).toBeVisible();

  // The Confusion Firewall: verify with warnings acknowledged.
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /verify and activate/i }).click();
  await expect(page.getByRole("button", { name: "Mark Metformin taken" })).toBeVisible();

  // Go offline, record the dose, come back online: it must sync exactly once.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Mark Metformin taken" }).click();
  await expect(page.getByText(/you're offline/i).first()).toBeVisible();
  await expect(page.getByText(/1 change\(s\) saved on this device/i)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/saved on this device/i)).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("Taken", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/recorded by Meena Test/)).toBeVisible();
  expect(problems).toEqual([]);
});

test("care gaps, briefing and task converter work for the owner", async ({ page }) => {
  const problems = watch(page);
  await login(page, "ravi@example.com");
  await expect(page.getByText("Today's care briefing")).toBeVisible();
  await page.goto("/app/continuity");
  await expect(page.getByText("Appointment has no one to accompany").first()).toBeVisible();
  await page.goto("/app/tasks");
  await page.getByRole("tab", { name: /task board/i }).click();
  await page.getByRole("button", { name: "In my own words" }).click();
  await page.getByLabel("Describe the tasks").fill("Ask Priya to take Dadi to the eye doctor tomorrow at 5 pm");
  await page.getByRole("button", { name: "Suggest tasks" }).click();
  await expect(page.getByRole("checkbox", { name: /create this task/i })).toBeChecked();
  await page.getByRole("button", { name: "Create selected tasks" }).click();
  await expect(page.getByText(/1 task\(s\) created/)).toBeVisible();
  expect(problems).toEqual([]);
});

test("emergency card: approve on the senior's behalf and open the public share link", async ({ page, browser }) => {
  const problems = watch(page);
  await login(page, "ravi@example.com");
  await page.goto("/app/emergency");
  // Mohan ("Dadaji") has no account of his own, so the owner may approve on his behalf.
  // (Kamla, "Dadi", signs in herself and approves her own card.)
  await page.getByRole("tab", { name: "Dadaji" }).click();
  await expect(page.getByRole("tab", { name: "Dadaji" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Blood group").selectOption("B+");
  await page.getByLabel("Allergies").fill("Penicillin");
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByRole("button", { name: "Approve this card" }).click();
  await expect(page.getByText(/approved by ravi/i)).toBeVisible();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Emergency link").inputValue();
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(link);
  await expect(pub.getByText("Emergency information")).toBeVisible();
  await expect(pub.getByText("Penicillin")).toBeVisible();
  await expect(pub.getByText("Mohan Lal Sharma")).toBeVisible();
  await anon.close();
  expect(problems).toEqual([]);
});

test("caregiver sees only permitted profiles and can work from the Responsibility Centre", async ({ page }) => {
  const problems = watch(page);
  await login(page, "anita@example.com");
  await page.goto("/app/profiles");
  await expect(page.getByText("Mohan Lal Sharma")).toBeVisible();
  await expect(page.getByText("Suresh Sharma")).toHaveCount(0);   // outside Anita's scope
  await page.goto("/app/tasks");
  await expectHealthy(page, "responsibility centre");
  expect(problems).toEqual([]);
});
