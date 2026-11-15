# Chiktsa — REST API

Base path: `/api`. All authenticated endpoints require `Authorization: Bearer <token>`
(a Firebase ID token in `firebase` mode, or a local access JWT in `local` mode).
Errors use `{ "error": { "code": "...", "message": "..." } }`.

Status legend: ✅ implemented & tested · 🕓 planned (later phase)

## Auth (local mode) — rate limited
| Method | Path | Body | Notes | Status |
|---|---|---|---|---|
| POST | `/auth/signup` | `{email, password, displayName, timezone?, locale?}` | Creates user; returns access token, sets refresh cookie | ✅ |
| POST | `/auth/login` | `{email, password}` | Returns access token, sets refresh cookie | ✅ |
| POST | `/auth/refresh` | — (cookie) | Rotates refresh token | ✅ |
| POST | `/auth/logout` | — | Revokes refresh token, clears cookie | ✅ |
| GET | `/auth/config` | — | `{provider}` so the SPA knows which adapter to use | ✅ |

## Me
| Method | Path | Notes | Status |
|---|---|---|---|
| GET | `/me` | Profile + memberships summary (household, role, scope) | ✅ |
| PATCH | `/me` | displayName, timezone, locale, accessibility | ✅ |
| GET | `/me/invitations` | Pending invitations addressed to my email | ✅ |

## Households
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | `/households` | (my memberships) | ✅ |
| POST | `/households` | any user → becomes `household_owner` | ✅ |
| GET | `/households/{hid}` | `household.read` | ✅ |
| PATCH | `/households/{hid}` | `household.manage` | ✅ |
| GET | `/households/{hid}/audit` | `audit.read` (`?seniorId=`) | ✅ |

## Members & invitations
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | `/households/{hid}/members` | `members.read` | ✅ |
| PATCH | `/households/{hid}/members/{uid}` | `members.manage` (role, scope, expiresAt, status) | ✅ |
| DELETE | `/households/{hid}/members/{uid}` | `members.manage` (revoke) or self (leave) | ✅ |
| GET | `/households/{hid}/invitations` | `members.manage` | ✅ |
| POST | `/households/{hid}/invitations` | `members.manage` | ✅ |
| DELETE | `/households/{hid}/invitations/{token}` | `members.manage` (revoke) | ✅ |
| GET | `/invitations/{token}` | authenticated (preview) | ✅ |
| POST | `/invitations/{token}/accept` | authenticated, email must match | ✅ |

## Seniors (elderly profiles)
| Method | Path | Permission | Status |
|---|---|---|---|
| GET | `/households/{hid}/seniors` | `senior.read` (filtered by scope) | ✅ |
| POST | `/households/{hid}/seniors` | `seniors.manage` | ✅ |
| GET | `/households/{hid}/seniors/{sid}` | `senior.read` + scope | ✅ |
| PATCH | `/households/{hid}/seniors/{sid}` | `seniors.manage` + scope | ✅ |
| DELETE | `/households/{hid}/seniors/{sid}` | `seniors.manage` (archives, never hard-deletes) | ✅ |

## Phase 2 — care records & intelligence engines ✅
`SEN` = `/households/{hid}/seniors/{sid}`. Every endpoint enforces role permission + profile scope + senior consent.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `SEN/medications` | List / add (always starts `pending_verification`) |
| GET/PATCH | `SEN/medications/{mid}` | Read (with ambiguity `issues`, `refill`) / edit (clinical edits force re-verification) |
| POST | `SEN/medications/{mid}/verify` | `{acknowledgeWarnings, note}` — refused while blocking issues exist |
| POST | `SEN/medications/{mid}/status` | pause / resume / end |
| POST | `SEN/medications/{mid}/refill` | Add collected stock |
| GET | `SEN/medications/{mid}/journey` | Medication Journey Timeline |
| GET | `SEN/medication-review` | Interaction review status + duplicate check |
| GET/POST | `SEN/doses` | Schedule for a local date range / record taken or skipped |
| GET | `SEN/adherence?days=` | Recorded outcomes |
| GET/POST | `SEN/appointments` · `/households/{hid}/appointments` | Per profile / household upcoming |
| PATCH · POST | `SEN/appointments/{aid}` · `/escort` `/postpone` `/complete` `/cancel` | Appointment workflow |
| GET/POST/PATCH | `/households/{hid}/tasks[/{tid}]` | Task board |
| POST | `/households/{hid}/tasks/{tid}/{accept\|decline\|claim\|complete\|cancel\|reassign}` | Task lifecycle |
| GET | `/households/{hid}/gaps?seniorId=` | Invisible Care Gap Detector |
| POST | `/households/{hid}/simulate` | What-If Simulator (read-only) |
| GET/POST | `/households/{hid}/handovers` · `POST …/{id}/acknowledge` | Handover Passport |
| GET/POST/DELETE | `/households/{hid}/absences` · `POST …/{id}/cover` | Absence Protocol |
| GET | `/households/{hid}/audit?seniorId=&targetType=&actorUid=` | Change Detective |
| GET | `/households/{hid}/contribution` | Workload + balancer suggestions |
| GET | `/me/overview` · `/me/responsibilities` | Cross-household views |
| GET · PUT · POST · DELETE | `SEN/consents` · `SEN/consents/{uid}` · `…/revoke` · restore | Consent Expiry Manager |
| GET · POST | `/me/notifications` · `…/{id}/read` · `…/read-all` | In-app notifications |

## Phase 3 — notification automation ✅
| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/jobs/tick` | Reminder engine tick (header `X-Job-Token`; Cloud Scheduler only) |
| GET · PUT | `/households/{hid}/notification-rules` | Escalation steps, quiet hours, reminder timings (`household.manage` to edit) |
| GET | `/households/{hid}/reminders?days=` | Reminder activity: recipients, escalations, acknowledgement, resolution |
| POST | `/households/{hid}/reminders/run` | Administrators: immediate, idempotent check for this household |
| POST | `/me/notifications/{id}/acknowledge` | "I'm on it" — stops escalation (does not record a dose) |
| GET · PUT | `/me/notification-preferences` | Email / push opt-in + server channel status |
| POST | `/me/devices` | Register an FCM device token |

## Phase 4 — AI workflows, notes & documents ✅
| Method | Path | Purpose |
|---|---|---|
| GET · PUT | `/households/{hid}/ai` | AI status / opt in to Gemini (`household.manage`) |
| POST | `SEN/memory/query` | Care Memory Bridge — cited answer from authorised records |
| GET | `/households/{hid}/briefing?refresh=` | Daily care briefing |
| GET | `SEN/appointments/{aid}/prep` | Appointment preparation sheet |
| POST | `/households/{hid}/tasks/convert` | Natural-language → task proposals (not saved) |
| GET · POST | `SEN/notes` | Daily observations |
| GET · POST (multipart) | `SEN/documents` | Document vault list / upload |
| GET | `SEN/documents/{did}/file` | Authorised streaming download (`no-store`) |
| DELETE | `SEN/documents/{did}` | Archive |
| POST | `SEN/documents/{did}/extract` | Prescription extraction (`{transcription?}`) |
| POST | `SEN/documents/{did}/drafts` | Create pending medications from reviewed items |

## Phase 5 — advanced modules ✅
| Method | Path | Purpose |
|---|---|---|
| GET · PUT | `SEN/preferences` | Personal wishes & care preferences |
| GET · POST | `SEN/wellness` | Wellness check-ins (history / today's check-in) |
| GET · PUT | `SEN/emergency` | Emergency card |
| POST | `SEN/emergency/approve` | Senior approval (admin only if the senior has no login) |
| POST · DELETE | `SEN/emergency/shares[/{id}]` | Create / revoke an expiring share link |
| GET | `/public/emergency/{token}` | Public, token-gated, rate-limited card view (no sign-in) |
| POST | `/sync/batch` | Offline sync — exactly-once, conflict-aware |
| POST | `SEN/voice` | Voice intent → spoken reply + proposed action |
| GET | `/households/{hid}/reports` · `/reports.csv` | Analytics / CSV export |
| GET | `SEN/appointments/{aid}/ics` | Calendar file |
| GET · POST | `/organisations` | My organisations / create |
| POST | `/organisations/{oid}/staff` · `/code` · `/assignments` | Staff, connection code, caregiver placement |
| GET | `/organisations/{oid}/dashboard` | Multi-household dashboard |
| POST · DELETE | `/households/{hid}/organisations[/{oid}]` | Connect / disconnect an organisation |

Interactive OpenAPI docs: `http://localhost:8080/api/docs` when the backend is running.
