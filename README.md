# CareHub AI

**One Platform. Every Generation. Connected Care.**

CareHub AI is a multi-tenant elderly-care coordination platform that connects seniors, families,
caregivers and care organisations. Multiple households, multiple elderly profiles per household,
per-profile permissions, and (in later phases) three intelligence engines: Care Continuity,
Medication Safety and Family Coordination.

> **Build status:** Phase 1 (foundation) is complete and tested. Later phases are planned and
> clearly labelled in the app; nothing is simulated. See [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Repository layout

```
backend/            FastAPI API (Python 3.11)
  app/core/         auth (local | firebase), RBAC + tenant isolation, rate limiting, logging
  app/db/           Store adapter: MemoryStore (dev/tests) | FirestoreStore (production)
  app/services/     households, members, invitations, seniors, users, audit
  app/api/routes/   thin REST routes
  scripts/          seed_demo.py (DEMO DATA ONLY)
  tests/            pytest — auth, isolation, RBAC, invitations, store contract
frontend/           React + TypeScript + Vite + Tailwind v4 + Radix (shadcn/ui-style)
  src/components/   design-system primitives, AppShell, SeniorShell, CareSwitcher
  src/features/     household / profile / care-circle / audit feature components
  src/pages/        public, auth and app pages
  src/test/         Vitest + React Testing Library
firestore-tests/    Firestore security-rules tests (emulator)
docs/               ARCHITECTURE, DATABASE, API, CHECKLIST, DEPLOYMENT
deploy/cloudrun.sh  Cloud Run deployment script
firestore.rules · firestore.indexes.json · storage.rules · firebase.json
```

## Run locally

Prerequisites: Python 3.11+, Node 20+.

**Backend**
```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt      # Windows (macOS/Linux: .venv/bin/pip)
.venv/Scripts/python -m uvicorn app.main:app --port 8080
```
API docs: http://localhost:8080/api/docs. By default the API runs with **local auth** and an
**in-memory store persisted to `backend/.data/dev-store.json`**, so no cloud credentials are needed.

**Frontend**
```bash
cd frontend
npm install
npm run dev            # http://localhost:5391 — proxies /api to http://127.0.0.1:8080
```

**Optional demo data** (multi-household scenarios; development store only):
```bash
cd backend && .venv/Scripts/python -m scripts.seed_demo
```
Demo accounts and their shared password are documented at the top of `backend/scripts/seed_demo.py`.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest -q        # API: auth, tenancy, RBAC, invitations
cd frontend && npm test                                # Vitest + RTL
cd frontend && npm run typecheck && npm run build
cd firestore-tests && npm install && npm test          # rules tests (needs Java 11+; downloads the emulator)
cd e2e && npm install && npx playwright install chromium && npx playwright test   # end-to-end, desktop + mobile
cd backend && .venv/Scripts/pip-audit && .venv/Scripts/bandit -q -r app -ll       # dependency + static security audit
```
The end-to-end suite starts its own isolated, freshly seeded API (port 8090) and web app (port 5392). It sweeps
every page as owner, administrator, caregiver and senior on desktop and mobile — failing on any console error,
server error, broken render or horizontal overflow — and runs real journeys, including Scenario G (record a dose
offline, reconnect, verify it synced exactly once).

## Live demo (Vercel)

`vercel.json` deploys the React app as static files and the FastAPI backend as a Python function (`api/index.py`).
The demo runs with `ENVIRONMENT=demo`: an in-memory store seeded with sample households on every cold start, so
**data resets** and a banner says so. Demo accounts (password `CareHubDemo2026`): `ravi@example.com` (owner),
`anita@example.com` (caregiver in two households), `priya@example.com` (family admin), `kamla@example.com` (senior).
Never enter real medical information into the demo. Production uses Cloud Run + Firestore + Firebase Auth.

## Configuration

* Backend: copy `backend/.env.example` to `backend/.env`.
* Frontend: copy `frontend/.env.example` to `frontend/.env.local`.
* **Never** put Gemini, email-provider or service-account keys in the frontend. Only public Firebase web config uses `VITE_*`.

| Variable | Where | Purpose |
|---|---|---|
| `ENVIRONMENT` | API | `development` / `test` / `production` (production refuses insecure settings) |
| `AUTH_PROVIDER` | API | `local` (dev) or `firebase` |
| `JWT_SECRET` | API | Local-auth signing secret (≥32 random chars) |
| `DATA_STORE` | API | `memory` (dev) or `firestore` |
| `FIREBASE_PROJECT_ID` | API | Firebase/GCP project |
| `GOOGLE_APPLICATION_CREDENTIALS` | API (local only) | Service-account JSON path; Cloud Run uses its service account |
| `CORS_ORIGINS`, `COOKIE_SECURE` | API | Browser security |
| `AUTH_RATE_LIMIT`, `AUTH_RATE_WINDOW_SECONDS` | API | Auth endpoint throttling |
| `VITE_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/APP_ID` | Web | Firebase web SDK (public config) |
| `VITE_CONTACT_EMAIL` | Web | Contact page address |
| `GEMINI_API_KEY`, `EMAIL_PROVIDER`, `EMAIL_API_KEY` | API | **Pending** — Phases 3–4 |

## Run on Firebase locally (emulators — no cloud account needed)

The whole stack runs on the official Firebase Auth + Firestore emulators, exercising exactly the
production code paths (Firebase ID tokens, Firestore queries, security rules):

```bash
cd firestore-tests && npm install && npm run emulators          # Auth :9099, Firestore :8085, UI :4000
```
Then, in two more terminals (or use the `api-firebase` / `web-firebase` configs in `.claude/launch.json`):
```bash
cd backend && set AUTH_PROVIDER=firebase& set DATA_STORE=firestore& set FIREBASE_PROJECT_ID=demo-carehub& set FIRESTORE_EMULATOR_HOST=127.0.0.1:8085& set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099& .venv\Scripts\python -m uvicorn app.main:app --port 8080
cd frontend && npm run dev -- --mode emulator
```
Test the API against the emulators (all 44 tests, incl. Firebase ID-token tests):
```bash
cd firestore-tests && npm run test:api
```
> Windows note: `firebase emulators:exec` can leave the Firestore Java process running after it
> exits. If a later run says "port taken", stop the leftover `java.exe` on port 8085.

## Switching to Firebase (production)

1. Create a Firebase project, enable **Authentication → Email/Password** and **Firestore (Native mode)**.
2. Deploy rules and indexes: `npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project <id>`.
3. API: `AUTH_PROVIDER=firebase`, `DATA_STORE=firestore`, `FIREBASE_PROJECT_ID=<id>` and credentials.
4. Web: set the `VITE_FIREBASE_*` values from the Firebase console (Project settings → Web app).

The SPA automatically uses the Firebase adapter when the API reports `provider: firebase`.

## Deploy to Cloud Run

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: `PROJECT_ID=<id> bash deploy/cloudrun.sh`.

## Safety principles

CareHub coordinates care; it **never diagnoses, prescribes or changes medication**. AI features
(Phase 4+) produce proposals that require human confirmation, cite source records, and use only
the minimal, authorised context for one senior in one household.
