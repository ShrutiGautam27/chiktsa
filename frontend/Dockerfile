# Chiktsa web — static SPA served by nginx on Cloud Run.
# nginx also reverse-proxies /api to the API service so auth cookies stay first-party (same origin).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public Firebase web config is safe to embed (it is not a secret); never put API keys for
# Gemini or other server-side services here.
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_CONTACT_EMAIL=""
RUN npm run build

FROM nginx:1.27-alpine
ENV PORT=8080 API_URL=http://localhost:8081
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
