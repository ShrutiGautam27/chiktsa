/**
 * Error sweep: visits EVERY page as each kind of user (desktop + mobile projects) and fails on any
 * uncaught exception, console error, server error, broken render, or horizontal overflow.
 */
import { expect, test } from "@playwright/test";
import { expectHealthy, login, watch } from "./helpers";

const PUBLIC = ["/", "/features", "/how-it-works", "/about", "/contact", "/login", "/signup", "/no-such-page"];
const FAMILY = ["/app", "/app/households", "/app/profiles", "/app/circle", "/app/coordination", "/app/medications", "/app/appointments",
  "/app/tasks", "/app/handover", "/app/continuity", "/app/medication-safety", "/app/memory", "/app/voice", "/app/documents",
  "/app/reports", "/app/emergency", "/app/consent", "/app/organisation", "/app/notifications", "/app/settings"];

test("public pages render without errors", async ({ page }) => {
  const problems = watch(page);
  for (const path of PUBLIC) {
    await page.goto(path);
    await expectHealthy(page, path);
  }
  expect(problems).toEqual([]);
});

for (const [who, email, extra] of [
  ["household owner", "ravi@example.com", ["/app/activity"]],
  ["family administrator", "priya@example.com", ["/app/activity"]],
  ["primary caregiver", "anita@example.com", []],
] as const) {
  test(`every app page works for the ${who}`, async ({ page }) => {
    const problems = watch(page);
    await login(page, email);
    for (const path of [...FAMILY, ...extra]) {
      await page.goto(path);
      await expectHealthy(page, `${who} ${path}`);
    }
    // Household and profile detail pages
    await page.goto("/app/households");
    await page.getByRole("heading", { level: 2 }).first().click();
    await expectHealthy(page, `${who} household detail`);
    for (const tab of ["Care circle", "AI & privacy"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByText("Something went wrong on this page")).toHaveCount(0);
    }
    await page.goto("/app/profiles");
    await page.getByRole("heading", { level: 3 }).first().click();
    await expectHealthy(page, `${who} profile page`);
    expect(problems).toEqual([]);
  });
}

test("senior mode works", async ({ page }) => {
  const problems = watch(page);
  await login(page, "kamla@example.com");
  for (const path of ["/app", "/app/settings", "/app/consent", "/app/emergency"]) {
    await page.goto(path);
    await expectHealthy(page, `senior ${path}`);
  }
  await page.goto("/app");
  await expect(page.getByRole("button", { name: /talk to carehub|carehub से बात/i })).toBeVisible();
  expect(problems).toEqual([]);
});

test("dark mode renders every main page", async ({ page }) => {
  const problems = watch(page);
  await page.addInitScript(() => localStorage.setItem("carehub.theme", "dark"));
  await login(page, "ravi@example.com");
  for (const path of ["/app", "/app/medications", "/app/continuity", "/app/reports"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectHealthy(page, `dark ${path}`);
  }
  expect(problems).toEqual([]);
});
