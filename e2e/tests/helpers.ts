import { expect, type Page } from "@playwright/test";

export const PASSWORD = "CareHubDemo2026"; // demo seed password (see backend/scripts/seed_demo.py)

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app/);
}

/** Collects runtime problems on a page: uncaught exceptions, console errors, 5xx API responses. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Expected: the browser logs intentional 4xx responses (permission checks) as "Failed to load resource".
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return;
    problems.push(`console: ${t}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    if (r.url().includes("/api/") && !/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(err)) problems.push(`request failed: ${r.url()} ${err}`);
  });
  return problems;
}

/** Page is healthy: rendered a heading, no error boundary, no horizontal scroll (responsive). */
export async function expectHealthy(page: Page, label: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator("h1").first(), `${label}: page heading`).toBeVisible();
  await expect(page.getByText("Something went wrong on this page"), `${label}: error boundary`).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: horizontal overflow (px)`).toBeLessThanOrEqual(1);
}
