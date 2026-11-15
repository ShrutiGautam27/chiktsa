// Runs the backend pytest suite (inside `firebase emulators:exec`, so FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST are set). Cross-platform path to the backend virtualenv's Python.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const backend = fileURLToPath(new URL("../backend/", import.meta.url));
const candidates = [join(backend, ".venv", "Scripts", "python.exe"), join(backend, ".venv", "bin", "python")];
const python = candidates.find((p) => existsSync(p)) ?? "python";
const r = spawnSync(python, ["-m", "pytest", "-q", "-p", "no:cacheprovider", ...process.argv.slice(2)], {
  cwd: backend,
  stdio: "inherit",
  env: { ...process.env, CAREHUB_TEST_STORE: "firestore" },
});
process.exit(r.status ?? 1);
