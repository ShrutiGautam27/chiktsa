# CareHub AI API — Cloud Run image
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /srv

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# Run as an unprivileged user
RUN useradd --create-home --uid 10001 carehub
USER carehub

EXPOSE 8080
# Cloud Run injects $PORT. --proxy-headers so client IPs (rate limiting) come from X-Forwarded-For.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
