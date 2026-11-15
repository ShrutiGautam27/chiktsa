# Deploying CareHub AI to Google Cloud Run

> Status: deployment configuration is written but has **not been executed** — no GCP project or
> credentials were provided. Follow these steps once you have them.

## Architecture

```
Browser ──HTTPS──▶ carehub-web (Cloud Run, nginx)
                     ├── /           static SPA (Vite build)
                     └── /api/*  ──▶ carehub-api (Cloud Run, FastAPI) ──▶ Firestore / Firebase Auth
```
nginx proxies `/api` so the browser sees a single origin (cookies stay first-party, no CORS needed).

## One-time setup

1. `gcloud auth login && gcloud config set project <PROJECT_ID>`
2. Firebase console: add the GCP project to Firebase, enable **Email/Password** sign-in, create a
   **Web app** and note its config values.
3. Firestore: create a database in **Native mode** (e.g. `asia-south1`).
4. Deploy rules and indexes:
   ```bash
   npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project <PROJECT_ID>
   ```
5. Service account: the Cloud Run runtime service account needs `roles/datastore.user` and
   `roles/firebaseauth.viewer` (for ID-token revocation checks).

## Reminder engine (Phase 3)

Create the job token secret once (the API refuses to start in production without it):
```bash
openssl rand -hex 32 | gcloud secrets create carehub-job-token --data-file=-
```
`deploy/cloudrun.sh` creates a Cloud Scheduler job that POSTs `/api/internal/jobs/tick` every minute with the
`X-Job-Token` header. The tick is idempotent (atomic Firestore `create()` per reminder key), so retries and
overlapping runs never duplicate notifications.

Optional channels: set `EMAIL_PROVIDER=resend|sendgrid` plus an `EMAIL_API_KEY` secret for email; set
`PUSH_ENABLED=true` once Firebase Cloud Messaging web push is configured.

## Deploy

```bash
export PROJECT_ID=<id> REGION=asia-south1
export VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=<id>.firebaseapp.com VITE_FIREBASE_APP_ID=...
bash deploy/cloudrun.sh
```

The script builds both images with Cloud Build, pushes them to Artifact Registry, and deploys:

| Service | Key settings |
|---|---|
| `carehub-api` | `ENVIRONMENT=production AUTH_PROVIDER=firebase DATA_STORE=firestore COOKIE_SECURE=true` |
| `carehub-web` | `API_URL=<carehub-api URL>` |

The API refuses to start in production with the in-memory store or a default JWT secret.

## Secrets (later phases)

Store server-side keys in Secret Manager and mount them as env vars, e.g.:
```bash
echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
gcloud run services update carehub-api --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

## Hardening checklist

* Put Cloud Armor (via an HTTPS load balancer) in front of `carehub-web` for global rate limiting —
  the in-process limiter is per instance.
* Enable Cloud Logging log-based alerts on 5xx and on `429` spikes.
* Point-in-time recovery and scheduled exports for Firestore.
