# --- Backend production image -------------------------------------------
# Build from repository root so backend can use the shared/ directory
# without changing the source-code structure.

FROM node:20-alpine AS deps

WORKDIR /app/backend

COPY backend/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund


FROM node:20-alpine AS runner

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]