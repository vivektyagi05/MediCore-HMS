# --- Backend production image -------------------------------------------
# Build from repository root so backend can use the shared/ directory
# without changing the source-code structure.

FROM node:22-alpine AS deps

WORKDIR /app/backend

COPY backend/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund


FROM node:22-alpine AS runner

WORKDIR /app

# Run as a non-root user.
RUN addgroup -S hms && adduser -S hms -G hms

ENV NODE_ENV=production

# Backend dependencies
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# Backend application
COPY backend/package*.json ./backend/
COPY backend/ ./backend/

# Shared application code used by backend controllers/services.
COPY shared/ ./shared/

# Uploaded files are written to backend/storage.
RUN mkdir -p /app/backend/storage && \
    chown -R hms:hms /app

USER hms

EXPOSE 5000

# N-023: readiness, not just liveness -- unhealthy when Mongo is down or the
# migration-011 indexes (scheduler lock, idempotency keys) are missing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The web process ONLY serves HTTP. Migrations run in a separate release step
# (`node backend/scripts/release.mjs`), never in every replica at start (N-001).
# The scheduler runs in a dedicated worker: `node backend/worker.js` with
# SERVICE_ROLE=worker (N-002). Both reuse this image.
CMD ["node", "backend/server.js"]
