# CareHub AI — Firestore Database Design

Design goals: tenant isolation by path, cheap membership checks in security rules, no
deep fan-out queries in hot paths, and a full audit trail.

## Collection hierarchy

```
users/{uid}
  email, displayName, locale ('en'|'hi'), timezone (IANA), phone?
  accessibility { fontScale, highContrast, simplifiedNav, voiceRate }
  platformRole: 'user' | 'platform_admin'
  createdAt, updatedAt
  users/{uid}/notifications/{notificationId}        (Phase 3) per-recipient inbox

authCredentials/{uid}                                 LOCAL AUTH MODE ONLY
  passwordHash (scrypt), refreshTokenHashes[]         never readable by clients

households/{hid}
  name, timezone, ownerId, organisationId?, seniorCount, memberCount, createdAt, updatedAt

  members/{uid}
    uid, householdId, role, status ('active'|'suspended'|'revoked')
    seniorScope: 'all' | [seniorId, …]
    linkedSeniorId?        (role = senior)
    expiresAt?             (temporary access)
    displayName, email     (denormalised for listings)
    invitedBy, joinedAt, updatedAt

  seniors/{sid}
    fullName, preferredName, dateOfBirth?, gender?, photoUrl?
    primaryLanguage, timezone, notes, status ('active'|'archived')
    emergencyContacts[], createdBy, createdAt, updatedAt

    medications/{medId}            (Phase 2)  status: 'pending_verification'|'active'|'paused'|'ended'
    doseEvents/{eventId}           (Phase 3)  scheduledFor, status: 'scheduled'|'taken'|'skipped'|'unconfirmed'
    appointments/{apptId}          (Phase 2)
    documents/{docId}              (Phase 4)  storagePath (private bucket), kind, extraction
    prescriptions/{rxId}           (Phase 4)  OCR text, structured fields, ambiguities, verification
    careLogs/{logId}               (Phase 3)
    wellnessEntries/{entryId}      (Phase 5)
    careMemory/{memoryId}          (Phase 4)  chunk text + embedding + sourceRef
    consents/{consentId}           (Phase 5)  granteeUid, categories[], expiresAt, revokedAt
    preferences/{prefId}           (Phase 5)

  tasks/{taskId}                   (Phase 2/3) seniorId, assigneeUid?, status, dueAt, kind, sensitivity
  handovers/{handoverId}           (Phase 3)
  absences/{absenceId}             (Phase 3)
  auditLogs/{logId}                actorUid, action, targetType, targetId, seniorId?, before?, after?, at

invitations/{token}                top-level so the invitee can resolve a token before membership
  householdId, householdName, email, role, seniorScope, invitedBy, status ('pending'|'accepted'|'revoked'|'expired')
  expiresAt, createdAt, acceptedBy?

organisations/{oid}                (Phase 5)
  name, createdBy
  members/{uid}       role: 'org_admin' | 'org_caregiver'
  households/{hid}    link record (contract status, assigned caregivers)
```

## Why this shape

* **Path-based tenancy.** All care records sit under `households/{hid}` so a rule can check
  `exists(/households/$(hid)/members/$(uid))` once and cover every subcollection.
* **Senior-level records nest under the senior** so a senior-scoped caregiver's permission can be
  checked against `members/{uid}.seniorScope` using the `sid` path segment.
* **Tasks live at household level** (with `seniorId`) because the Responsibility Centre and gap
  detector query across all seniors of a household; the API strips medical detail for members whose
  scope does not include that senior.
* **"Which households am I in?"** uses a collection-group query on `members` filtered by `uid`
  (index below) — one query regardless of how many households exist.
* **Invitations are top-level** keyed by an unguessable token (256-bit) so an invitee who is not yet
  a member can look one up; they carry no medical data.
* **Audit logs** store before/after snapshots of changed fields — the data source for the Care
  Change Detective.

## Indexes (`firestore.indexes.json`)

| Collection (scope) | Fields |
|---|---|
| `members` (collection group) | `uid ASC, status ASC` |
| `auditLogs` | `seniorId ASC, at DESC` |
| `tasks` | `seniorId ASC, status ASC, dueAt ASC` |
| `tasks` | `assigneeUid ASC, status ASC, dueAt ASC` |
| `invitations` | `householdId ASC, status ASC` |
| `doseEvents` (collection group) | `status ASC, scheduledFor ASC` (Phase 3 scheduler) |

## Local development store

`MemoryStore` implements the same path-based API in memory and can persist to
`backend/.data/dev-store.json`. It enforces nothing about authorisation itself — exactly like the
Admin SDK — so the service-layer RBAC is exercised identically in tests and production.
