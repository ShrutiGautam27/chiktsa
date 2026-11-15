import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PY = path.resolve(__dirname, "../backend/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: { baseURL: "http://localhost:5392", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 850 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: `"${PY}" start_api.py`, url: "http://127.0.0.1:8090/api/health", reuseExistingServer: false, timeout: 180_000 },
    {
      command: "npx vite --port 5392 --strictPort",
      cwd: path.resolve(__dirname, "../frontend"),
      url: "http://localhost:5392",
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_PROXY_TARGET: "http://127.0.0.1:8090" },
    },
  ],
});
