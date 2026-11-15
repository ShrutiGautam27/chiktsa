# CareHub AI — Technical Architecture

> One Platform. Every Generation. Connected Care.

## 1. Workspace inspection (start of build)

| Item | Finding |
|---|---|
| Existing code | **None** — the workspace was empty. This is a greenfield build. |
| Node / npm | v24.13 / 11.6 |
| Python | 3.11.3 (backend venv), 3.13 also present |
| Java | 26 (sufficient for the Firestore emulator) |
| Firebase CLI, gcloud, Docker | **Not installed** |
| Credentials | **None provided** (Firebase, Gemini, GCP, Resend/SendGrid, Google Calendar) |

Because no credentials exist, every external service sits behind an adapter with a
**production implementation** and a **local-development implementation**. The app runs fully
in local mode today; switching to Firebase/Gemini is configuration only.

## 2. System overview

```
┌──────────────────────────┐        HTTPS (Bearer token)        ┌──────────────────────────────┐
│  React + TS + Vite SPA   │ ─────────────────────────────────▶ │  FastAPI (Python) — Cloud Run │
│  Tailwind + shadcn/ui    │                                     │                              │
│  TanStack Query, RHF+Zod │ ◀───────────────────────────────── │  api/ routes (thin)          │
│  Auth adapter:           │          JSON (Pydantic)            │  core/ auth, RBAC, rate limit│
│   • Firebase Auth (prod) │                                     │  services/ domain logic      │
│   • Local auth (dev)     │                                     │  ai/ orchestration (Gemini)  │
└──────────────────────────┘                                     │  db/ Store adapter           │
                                                                 │   • FirestoreStore (prod)    │
                                                                 │   • MemoryStore+JSON (dev)   │
                                                                 └──────────────┬───────────────┘
                                                                                │
                               Firestore · Storage · FCM · Gemini · STT/TTS · Scheduler · Logging
```

**Key principle: the browser never talks to Firestore directly for writes.** All mutations go through
FastAPI, which authenticates the caller, authorises them against the household membership and
senior scope, validates input with Pydantic, writes an audit log entry and only then persists.
Firestore security rules are a second, independent layer (defence in depth) that deny all client
writes and allow scoped reads only to active household members.

## 3. Multi-tenancy model

* **Tenant = household.** Every care record lives under `households/{householdId}/…`.
* A **membership** document `households/{hid}/members/{uid}` binds a user to a household with:
  `role`, `status` (`active | suspended | revoked`), `seniorScope` (`all` or a list of senior IDs),
  optional `expiresAt` (temporary access) and optional `linkedSeniorId` (for the senior themself).
* A user can belong to any number of households; a caregiver can be a member of many households with
  a different role and scope in each. Organisations link to the households they serve and their
  staff become scoped members of those households.
* **Every** service function takes `(actor, householdId, [seniorId])` and calls
  `rbac.authorize(...)` before touching data. There are no unscoped queries in request paths.
* Cross-household listings (e.g. "my households", Universal Care Switcher, Responsibility Centre)
  iterate the caller's memberships and query each tenant separately — data from different
  households is never merged into a single query result without a per-tenant authorisation check.

## 4. Roles and permissions

| Role | Purpose |
|---|---|
| `platform_admin` | Platform operations only. **No implicit access to care records** (data minimisation). |
| `household_owner` | Created the household. Full control, cannot be removed except by transfer. |
| `family_admin` | Manages members, seniors, permissions. |
| `family_member` | Views care information, accepts and completes tasks. |
| `primary_caregiver` | Day-to-day care: medications status, tasks, handovers, care logs. |
| `secondary_caregiver` | Backup caregiver: tasks and observations; limited editing. |
| `org_admin` | Professional organisation administrator for linked households. |
| `senior` | The elderly person. Controls their own consent; simplified UI. |

Permissions are fine-grained strings (see `backend/app/core/rbac.py`). The effective permission set
is `role permissions ∩ senior scope ∩ active consent ∩ not expired`. Consent restrictions set by a
senior can only narrow access, never widen it.

## 5. Authentication

| Mode | Frontend | Backend |
|---|---|---|
| `firebase` (production) | Firebase JS SDK sign-in; sends Firebase ID token as Bearer | `firebase_admin.auth.verify_id_token` |
| `local` (development / demo) | Email+password against `/api/auth/*` | scrypt password hashing, short-lived HS256 access JWT (15 min) + rotating refresh token in an `HttpOnly; SameSite=Strict` cookie |

Selected with `AUTH_PROVIDER` (backend) and the presence of `VITE_FIREBASE_*` (frontend). Local
mode refuses to start with the default secret when `ENVIRONMENT=production`.

## 6. Backend layout

```
backend/
  app/
    main.py              FastAPI app factory, middleware, routers
    config.py            Settings (pydantic-settings, env-driven)
    core/
      auth.py            Token verification (firebase | local), current-user dependency
      passwords.py       scrypt hashing
      rbac.py            Roles, permissions, authorize()
      errors.py          Typed domain errors -> HTTP
      ratelimit.py       Sliding-window rate limiter middleware
      logging.py         Structured logging without PHI
    db/
      store.py           Store protocol (get/set/update/delete/query/collection_group)
      memory.py          In-memory store with optional JSON persistence (dev, tests)
      firestore.py       Firestore implementation (Admin SDK)
    schemas/             Pydantic request/response models
    services/            users, households, members, seniors, invitations, audit
    api/routes/          auth, me, households, members, seniors, invitations, audit
    ai/                  (Phase 4) Gemini orchestration services
  tests/                 pytest — auth, tenancy isolation, RBAC, scenarios
```

## 7. Frontend layout

```
frontend/src/
  main.tsx, App.tsx (router)
  lib/          api client, auth adapters, utils, query client
  components/ui shadcn-style primitives (Button, Card, Dialog, Input, Select, …)
  components/   layout (PublicLayout, AppShell, Sidebar), CareSwitcher, EmptyState, …
  features/     auth, households, seniors, members, invitations, settings, dashboard
  pages/        public pages + authenticated pages
  hooks/        useAuth, useHouseholds, useCareContext, …
  styles/       Tailwind v4 theme tokens (ivory / emerald / sage / charcoal / champagne)
```

Role-specific navigation is derived from the active membership role. Seniors get a separate,
substantially simplified "Senior Mode" layout with large type and large targets.

## 8. AI architecture (Phase 4+)

`app/ai/` contains an `LLMClient` protocol with `GeminiClient` (structured JSON output via
`response_schema`) and a deterministic `OfflineClient` for development/tests. Each product service
(`CareMemoryService`, `CareGapDetectionService`, `PrescriptionExtractionService`, …) builds a
**minimal, authorised context** for one senior in one household, calls the LLM with a Pydantic schema,
validates the output and returns *proposals* that require human confirmation before any write.
Guardrails: never diagnose, never change medication, cite record IDs, admit missing info.

## 9. Background processing (Phase 3)

Cloud Scheduler → authenticated `POST /internal/jobs/tick` on Cloud Run every minute. The job
materialises due reminders, applies escalation rules and sends notifications. Idempotency keys
(`{type}:{targetId}:{scheduledFor}`) stored in `notifications` prevent duplicate sends.

## 10. Deployment

Two Cloud Run services (`carehub-api`, `carehub-web`), each with its own Dockerfile. Secrets in
Secret Manager, mounted as env vars. Firestore rules and indexes deployed with the Firebase CLI.
See `README.md` and `docs/DEPLOYMENT.md`.
