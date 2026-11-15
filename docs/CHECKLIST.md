# CareHub AI — Implementation Checklist

Legend: ✅ implemented & tested · 🟡 built, needs credentials/external service to exercise · ⬜ not started

_Last updated: 2026-11-15, end of Phase 5 (advanced modules)._

## External credentials required (none provided yet)
| Service | Env vars | Used for | Status |
|---|---|---|---|
| Firebase project (Auth, Firestore, Storage, FCM) | `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `VITE_FIREBASE_*` | Production auth & data | ✅ verified end-to-end on Firebase emulators · 🟡 real project needs the owner's Google account |
| Google Gemini | `GEMINI_API_KEY` | AI workflows | 🟡 client built & tested; offline mode in use until a key is set and a household opts in |
| Cloud Vision / Document AI | — | Prescription OCR | ➖ not needed: Gemini multimodal reads prescriptions |
| Speech-to-Text / Text-to-Speech | GCP service account | Voice companion | ⬜ Phase 5 (browser speech used for read-aloud today) |
| Resend or SendGrid | `EMAIL_PROVIDER`, `EMAIL_API_KEY` | Reminder & alert email | 🟡 adapter built and tested with a mocked provider; needs a key |
| Google Calendar API | OAuth client | Two-way appointment sync | 🟡 .ics export + add-to-calendar links work; OAuth sync pending |
| Cloud Run / Scheduler / Logging | GCP project | Deployment & jobs | 🟡 Dockerfiles + deploy script written, not executed |

## Phase 1 — Foundation
| Feature | Status | Evidence |
|---|---|---|
| Architecture, DB design, API spec, checklist | ✅ | `docs/` |
| Design system (ivory / emerald / sage / charcoal / champagne, Fraunces + Inter) | ✅ | `frontend/src/styles/index.css`, `components/ui/*` |
| Local auth: scrypt hashing, 15-min access JWT, rotating HttpOnly SameSite=Strict refresh cookie, reuse detection with 30 s concurrency grace | ✅ | `tests/test_auth.py`, browser-verified reload persistence |
| Firebase auth: ID-token verification (API) + JS SDK adapter (web) | ✅ (emulator) | `test_firebase_auth.py`; browser sign-up via Firebase Auth emulator |
| Rate limiting on auth + invitation endpoints | ✅ | `test_rate_limit_on_login` |
| Household creation / edit; user in many households | ✅ | `test_tenancy.py` Scenario B, browser-verified |
| Multiple independent elderly profiles per household; archive (never hard-delete) | ✅ | Scenario A test, browser-verified |
| Roles (7) + fine-grained permissions + per-profile scope + temporary expiry + revocation | ✅ | `test_rbac.py`, `test_tenancy.py` |
| Server-side tenant isolation (non-members get 404 on every route) | ✅ | Scenario F test (12 probes) |
| Privilege-escalation guards (owner immutable, admins can't grant admin or edit peers/self) | ✅ | `test_admin_cannot_escalate_or_manage_peer_admins` |
| Invitations: 256-bit token shown once, only SHA-256 stored, email-bound, single-use, expiring, revocable, supersede | ✅ | `test_invitations.py`, browser-verified end to end |
| Audit log on every write with field-level before/after (Change Detective foundation) | ✅ | tests + Activity page |
| Universal Care Switcher (household + profile, IDs-only persistence) | ✅ | browser-verified |
| Global household dashboard + individual profile dashboard | ✅ (Phase 1 data) | widgets for later modules shown as "Phase N", no fake data |
| Role-specific navigation; simplified Senior Mode (large type, read-aloud, trusted contacts) | ✅ | `logic.test.ts`, browser-verified as senior |
| Accessibility settings: font scale, high contrast, simplified nav, reduced motion, voice rate | ✅ | Settings page, persisted per user |
| Public pages: Landing, Features, How it works, About, Contact, Login, Signup | ✅ | Contact shows configured email only (no fake form) |
| Form validation (Zod + Pydantic), loading skeletons, empty/error states, toasts, confirm dialogs | ✅ | `auth.test.tsx` |
| Responsive layout (desktop sidebar, mobile drawer, no horizontal scroll at 375 px) | ✅ | browser-verified |
| Store adapter: MemoryStore (+JSON persistence) / FirestoreStore | ✅ / ✅ (emulator) | full API suite passes on both: 41 (memory) and 44 (Firestore + Auth emulators) |
| Firestore rules (incl. subcollections, scope, expiry, no client writes) + indexes + storage rules | ✅ | 11/11 emulator tests, `firestore-tests/rules.test.js` |
| Security headers, no-store caching of API responses, PHI-free request logs | ✅ | `main.py`, `core/logging.py` |
| Dockerfiles, nginx same-origin proxy, Cloud Run script, env examples, README | 🟡 | not executed (no GCP project / Docker locally) |
| Demo seed (clearly marked, dev store only) | ✅ | `backend/scripts/seed_demo.py` |
| Light / dark / system theme toggle (header, Senior Mode, auth pages, Settings), no-flash init | ✅ | `theme.test.tsx`, browser-verified |
| Route code-splitting (main chunk 566 kB → 430 kB; Firebase SDK lazy), per-page titles, error boundary, heading order, skip links, OG/manifest/robots | ✅ | build output, browser-verified |

## Phase 2 — Core care records + the three intelligence engines
Tests: `backend/tests/test_medications.py` (21), `test_engines.py` (19), frontend `care.test.tsx`. Whole API suite also passes on the Firestore + Auth emulators (84).

### Engine 1 — Care Continuity Intelligence
| Feature | Status | Notes |
|---|---|---|
| Invisible Care Gap Detector (13 rule types: no escort, unconfirmed/inactive/absent escort, unverified meds, no/lapsed/absent dose responsibility, low stock, unrecorded doses, unassigned/overdue/orphaned/unaccepted tasks, unacknowledged handovers) | ✅ | Deterministic and explainable; never diagnoses; scope + consent aware |
| Caregiver Handover Passport (auto snapshot: completed/pending tasks, appointments, dose records, medication changes since last handover; acknowledgement) | ✅ | Medication details redacted without consent |
| Caregiver Absence Protocol (affected tasks & escort duties, authorised backups, cover acceptance, family notified, audited) — Scenario D | ✅ | |
| Care Change Detective (who / when / previous → current / who approved; filters by profile, record type, actor) | ✅ | |
| What-If Simulator (caregiver unavailable, appointment postponed, stock depletion, connectivity failure) | ✅ | Read-only, "not a medical prediction" |

### Engine 2 — Medication Safety Intelligence
| Feature | Status | Notes |
|---|---|---|
| Medication CRUD, schedules, start/end, days of week, pause/resume/end | ✅ | |
| Prescription Confusion Firewall: unclear-field flags, missing fields, frequency conflicts, ISMP error-prone notation, date conflicts, duplicates; verification gate; warnings need acknowledgement; clinical edits force re-verification — Scenario E | ✅ | |
| Prescription OCR from photo/PDF | 🟡 | Pending Gemini / Cloud Vision credentials (Phase 4); manual transcription path works today |
| Dose schedule in senior's local time, taken/skipped recording, "unconfirmed" never "missed", stock follows confirmed intake | ✅ | |
| Adherence history (7/30 days, per medication + daily chart) | ✅ | |
| Refill intelligence (days remaining, depletion date, level, 30-day checklist, record refill) | ✅ | |
| Medication Journey Timeline | ✅ | |
| Interaction review | 🟡 | Honest "unavailable" until a licensed database is connected; exact-duplicate check only |

### Engine 3 — Family Coordination Intelligence
| Feature | Status | Notes |
|---|---|---|
| Family Care Circle + task assignment / accept / decline / claim / complete / reassign | ✅ | |
| Contribution & workload view (alphabetical, never ranked), imbalance detection | ✅ | |
| Caregiver Workload Balancer suggestions + one-click audited reassignment | ✅ | |
| Universal Care Switcher consolidated overview across households (counts only) | ✅ | |
| Consent Expiry Manager (limit categories, time-box, revoke, restore, history; senior-controlled; owner exempt) | ✅ | Enforced server-side on every read |
| Family Time-Zone Coordinator (viewer's zone + senior's local time) | ✅ | |
| Care Responsibility Centre across households (tasks, cover requests, escorts, handovers, claimable) with redaction | ✅ | |
| Appointments (escort request/accept/volunteer, postpone history + re-confirmation, complete/cancel, Doctor Visit Timeline) | ✅ | |
| In-app notifications (idempotent, data-minimised) + header bell | ✅ | Email/push delivery pending provider credentials |
| Real dashboards (household + profile) and Senior Mode (today's medicines, appointments, consent) | ✅ | AI daily briefing pending Phase 4 |
| Firestore rules: medical subcollections, tasks, handovers, absences server-only | ✅ | 12 emulator tests |

## Phase 3 — Notification automation
Tests: `backend/tests/test_automation.py` (24), frontend `automation.test.tsx` (3). Full API suite: 105 (memory) / 108 (Firestore + Auth emulators).

| Feature | Status | Notes |
|---|---|---|
| Reminder engine `run_tick` (Cloud Scheduler endpoint + dev in-process scheduler) | ✅ | Token-protected `/api/internal/jobs/tick`; runs logged in `jobRuns` |
| Duplicate prevention | ✅ | Deterministic keys + atomic `create()` (Firestore precondition) |
| Medication reminders at dose time → configurable escalation steps → resolved on record / stopped on acknowledgement | ✅ | Never "missed"; one step per tick; falls back to owner/admins if a role is empty |
| Quiet hours (escalations & non-urgent notices held until morning) | ✅ | Dose-time reminders still sent |
| Catch-up safety after downtime (no stale reminder floods) | ✅ | |
| Appointment reminders (configurable hours), re-sent after postponement | ✅ | |
| Escort confirmation nudges, unconfirmed-escort and no-escort alerts | ✅ | |
| Task due / overdue / unaccepted / unassigned reminders | ✅ | |
| Handover acknowledgement reminders → admin escalation | ✅ | |
| Low-stock alerts when the level worsens; consent-expiry notices | ✅ | |
| Delivery records per channel (in-app / email / push) + acknowledgement status | ✅ | |
| Email via Resend / SendGrid | 🟡 | Needs `EMAIL_API_KEY` |
| Push via Firebase Cloud Messaging | 🟡 | Adapter + device endpoint; needs FCM web-push setup (VAPID key, service worker) |
| Rules editor, reminder activity log, "Check now", delivery preferences, one-tap dose recording from reminders | ✅ | |
| Google Calendar sync | ⬜ | Phase 5 (needs OAuth client) |

## Phase 4 — AI workflows
Tests: `backend/tests/test_ai.py` (20), frontend `ai.test.tsx` (2). Full API suite: 125 (memory) / 128 (Firestore + Auth emulators).

| Feature | Status | Notes |
|---|---|---|
| AI service layer: Gemini REST client (structured JSON via `responseSchema`), schema validation, fallback | ✅ / 🟡 | Client tested against a mocked API; live use needs `GEMINI_API_KEY` |
| Household opt-in for cloud AI (offline by default), audited | ✅ | No record leaves CareHub until an admin enables Gemini |
| Guardrails: no diagnosis / prescribing / dose changes / extra doses; clinical escalation; unsafe output replaced | ✅ | Enforced in prompt AND on output |
| Minimal authorised context (one senior, scope + consent aware) | ✅ | Tested: other profiles never reach the prompt |
| AI usage audit (who/which workflow/engine — never content) + per-user rate limit | ✅ | |
| AI Care Memory Bridge (retrieval over notes, visits, medicines, documents, handovers, tasks; cited answers; admits gaps) | ✅ | Invented citations dropped; unsupported answers become "not found" |
| AI Daily Care Briefing (grounded facts → headline, summary, linked priorities; 30-min cache) | ✅ | |
| Intelligent Appointment Preparation (verified medicines only, unverified items as questions, dose records, observations, previous visits, documents, printable) | ✅ | |
| Prescription extraction → Confusion Firewall (photo/PDF via Gemini; offline parser for transcriptions incl. "1-0-1"; unclear fields flagged; drafts stay pending; times never guessed) | ✅ / 🟡 | Photo OCR needs Gemini; transcription path works today |
| Dialect-to-Care Task Converter (English/Hindi/Hinglish → proposals; IDs, dates and eligibility validated; confirm before save) | ✅ | |
| Care notes (daily observations) | ✅ | |
| Secure Medical Document Vault (content-sniffed types, size limit, private storage, authorised streaming, access audit, archive) | ✅ / 🟡 | Local storage in dev; GCS adapter needs a bucket |
| Care Gap Detection | ✅ | Rule engine (Phase 2) feeds the briefing; AI only phrases it |

## Phase 5 — Advanced modules
Tests: `backend/tests/test_phase5.py` (14), frontend `phase5.test.tsx` (4). Full API suite: 139 (memory) / 142 (Firestore + Auth emulators).

| Feature | Status | Notes |
|---|---|---|
| Internet Independence Mode — offline queue, exactly-once `/sync/batch`, conflict handling (server keeps newer change), opt-in essentials cache, offline app shell (service worker) — Scenario G | ✅ | Doses, observations, task completion, check-ins work offline |
| Voice-First Care Companion (English & Hindi intents, spoken replies, confirm-before-record, call contact, emergency) | ✅ / 🟡 | Browser speech engine; Google Cloud Speech-to-Text / Text-to-Speech need credentials |
| No-Screen Care Mode (auto read-aloud, voice-only home) | ✅ | |
| Emergency Care Snapshot (senior-approved, edits need re-approval, expiring/revocable/view-logged share link, printable) | ✅ | |
| Personal Wishes & Care Preferences | ✅ | Senior or administrator edits |
| Wellness Check-ins (voluntary, self-reported, "please call me" notifies family, trend) | ✅ | Never interpreted clinically |
| Organisations (create, staff, connect households by code, place caregivers on specific profiles, multi-household dashboard, disconnect revokes access) | ✅ | Staff must already have a CareHub account |
| Reports & Analytics (dose records, task throughput, reminder response, appointments, wellness) + CSV export | ✅ | Coordination metrics only |
| Calendar: .ics download + "Add to Google Calendar" link | ✅ / 🟡 | Two-way Google Calendar sync needs an OAuth client |
| Hindi labels in Senior Mode | ✅ | |

## Phase 6 — Hardening & deploy
Playwright e2e · performance · Cloud Run deployment — ⬜
