#!/usr/bin/env bash
# Deploy Chiktsa to Google Cloud Run. Requires: gcloud CLI, an authenticated account,
# a GCP project with Firestore (Native mode) and Firebase Auth enabled. See docs/DEPLOYMENT.md.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-carehub}"
API_SERVICE="${API_SERVICE:-carehub-api}"
WEB_SERVICE="${WEB_SERVICE:-carehub-web}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION"

# ---- API
gcloud builds submit backend --tag "${REGISTRY}/api:latest"
gcloud run deploy "$API_SERVICE" \
  --image "${REGISTRY}/api:latest" --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "ENVIRONMENT=production,AUTH_PROVIDER=firebase,DATA_STORE=firestore,FIREBASE_PROJECT_ID=${PROJECT_ID},COOKIE_SECURE=true,RUN_SCHEDULER_IN_PROCESS=false" \
  --set-secrets "JOB_TOKEN=carehub-job-token:latest" \
  --min-instances 0 --max-instances 10 --memory 512Mi
API_URL="$(gcloud run services describe "$API_SERVICE" --region "$REGION" --format 'value(status.url)')"

# ---- Reminder engine: Cloud Scheduler calls the idempotent tick every minute
gcloud services enable cloudscheduler.googleapis.com
JOB_TOKEN_VALUE="$(gcloud secrets versions access latest --secret carehub-job-token)"
gcloud scheduler jobs describe carehub-tick --location "$REGION" >/dev/null 2>&1 || \
  gcloud scheduler jobs create http carehub-tick --location "$REGION" --schedule "* * * * *" \
    --uri "${API_URL}/api/internal/jobs/tick" --http-method POST \
    --headers "X-Job-Token=${JOB_TOKEN_VALUE}" --attempt-deadline 120s

# ---- Web (nginx proxies /api to the API service)
gcloud builds submit frontend --config - <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ["build", "-t", "${REGISTRY}/web:latest",
         "--build-arg", "VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY:-}",
         "--build-arg", "VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN:-}",
         "--build-arg", "VITE_FIREBASE_PROJECT_ID=${PROJECT_ID}",
         "--build-arg", "VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID:-}", "."]
images: ["${REGISTRY}/web:latest"]
EOF
gcloud run deploy "$WEB_SERVICE" \
  --image "${REGISTRY}/web:latest" --region "$REGION" --allow-unauthenticated \
  --set-env-vars "API_URL=${API_URL}"

echo "Deployed. Web: $(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format 'value(status.url)')"
echo "Remember: set CORS_ORIGINS on the API if it is called from any origin other than the web service."
