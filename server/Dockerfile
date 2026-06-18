FROM node:20-alpine AS builder
WORKDIR /app

# The SOP auto-generator (tools/generate_sop.mjs) uses Playwright, but it runs as
# a separate tool with its own browser — not inside this app image. Skip the
# Playwright browser download so `npm install` stays fast and never fails here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy all package files for full workspace install
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY admin/package.json admin/
COPY desktop/package.json desktop/

# Full install to ensure workspace symlinks are created
RUN npm install

# Copy source
COPY shared/ shared/
COPY server/ server/

# Build shared, then manually place it in node_modules for tsc resolution
RUN npm run build -w shared && \
    rm -rf node_modules/@squadhub/shared && \
    mkdir -p node_modules/@squadhub/shared && \
    cp shared/package.json node_modules/@squadhub/shared/ && \
    cp -r shared/dist node_modules/@squadhub/shared/ && \
    npm run build -w server

# ---- Production image ----
FROM node:20-alpine
WORKDIR /app

# Chromium for the SOP auto-generator. Playwright can't run its bundled
# (glibc) browser on alpine/musl, so it drives the system Chromium via
# SOP_CHROMIUM_PATH. Enables the in-admin "Auto-generate" button on prod.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont && \
    if [ ! -e /usr/bin/chromium-browser ] && [ -e /usr/bin/chromium ]; then \
      ln -s /usr/bin/chromium /usr/bin/chromium-browser; fi

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/shared/dist/ ./shared/dist/
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/server/dist/ ./server/dist/
COPY --from=builder /app/server/package.json ./server/
# In-app updater version manifest (served by GET /partner-app/version). Can be
# overridden at runtime via PARTNER_RELEASE_MANIFEST_PATH (e.g. a mounted file).
COPY --from=builder /app/server/partner-release-manifest.json ./server/
# Generator script + recipe specs (spawned as a child process by the server).
COPY tools/ ./tools/

EXPOSE 4000

CMD ["node", "server/dist/index.js"]
