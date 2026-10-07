# Build context is the repository root so the image can bundle pol_relay.py:
#   docker build -f pol-panel/Dockerfile -t pol-panel ..
#
# ── build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY pol-panel/package.json pol-panel/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY pol-panel/ ./
RUN npm run build && npm prune --omit=dev

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# The relay is Python, the panel is Node: both live in this image.
RUN apk add --no-cache python3 && ln -sf /usr/bin/python3 /usr/local/bin/python3

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/index.html ./index.html
COPY pol_relay.py ./pol_relay.py

ENV NODE_ENV=production \
    PANEL_PORT=7178 \
    PANEL_HOST=0.0.0.0 \
    PANEL_ALLOW_PUBLIC=true \
    POL_RELAY_PORT=7179 \
    POL_RELAY_SCRIPT=/app/pol_relay.py \
    POL_RELAY_CWD=/app \
    POL_DATA_DIR=/app/data \
    PYTHON_BIN=python3

RUN mkdir -p /app/data && chmod 700 /app/data
VOLUME ["/app/data"]
EXPOSE 7178

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7178/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
