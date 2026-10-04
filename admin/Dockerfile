# Supply the sibling core with --build-context squad_bots=../squad-bots/packages/core.
FROM node:20-alpine AS squad-bots-core
WORKDIR /squad-bots/packages/core
COPY --from=squad_bots . .
RUN npm install --legacy-peer-deps && npm run build

FROM node:20-alpine AS builder
WORKDIR /app

# The SOP auto-generator (tools/generate_sop.mjs) uses Playwright, but it runs as
# a separate tool with its own browser — not inside this app image. Skip the
# Playwright browser download so `npm install` stays fast and never fails here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy all package files for full workspace install
COPY --from=squad-bots-core /squad-bots/packages/core /squad-bots/packages/core
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY admin/package.json admin/
COPY ["desktop companion app/package.json", "desktop companion app/"]

# Full install to ensure workspace symlinks are created
RUN npm install --install-links --legacy-peer-deps

# Copy source
COPY shared/ shared/
COPY admin/ admin/

# Build shared first, then admin
ARG NEXT_PUBLIC_SQUAD_BOTS_URL=http://localhost:3020
ENV NEXT_PUBLIC_SQUAD_BOTS_URL=$NEXT_PUBLIC_SQUAD_BOTS_URL
ARG INTERNAL_API_URL=http://server:4000
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN npm run build -w shared && npm run build -w admin

# ---- Next.js Runtime ----
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY --from=squad-bots-core /squad-bots/packages/core /squad-bots/packages/core
COPY package.json package-lock.json* ./
COPY admin/package.json admin/

# Install only production dependencies
RUN npm install --production --install-links --legacy-peer-deps

# Copy built app and public files from builder
COPY --from=builder /app/admin/.next /app/admin/.next
COPY --from=builder /app/admin/next.config.mjs /app/admin/next.config.mjs
COPY --from=builder /app/admin/postcss.config.mjs /app/admin/postcss.config.mjs
COPY admin/public /app/admin/public

EXPOSE 3001

CMD ["npm", "start", "-w", "admin"]

