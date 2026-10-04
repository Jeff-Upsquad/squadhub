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
COPY web/ web/
# The Leads mini app compiles the admin panel's lead-pipeline modules from
# source (see the `@` alias in web/next.config.mjs), so this image needs the
# admin tree too — without it the web build fails to resolve `@/views/admin/*`.
COPY admin/ admin/

# Build shared first, then web
ARG NEXT_PUBLIC_SQUAD_BOTS_URL=http://localhost:3020
ENV NEXT_PUBLIC_SQUAD_BOTS_URL=$NEXT_PUBLIC_SQUAD_BOTS_URL
ARG INTERNAL_API_URL=http://server:4000
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN npm run build -w shared && npm run build -w web

# ---- Next.js Runtime ----
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY --from=squad-bots-core /squad-bots/packages/core /squad-bots/packages/core
COPY package.json package-lock.json* ./
COPY web/package.json web/

# Install only production dependencies
RUN npm install --production --install-links --legacy-peer-deps

# Copy built app and public files from builder
COPY --from=builder /app/web/.next /app/web/.next
COPY --from=builder /app/web/next.config.mjs /app/web/next.config.mjs
COPY --from=builder /app/web/postcss.config.mjs /app/web/postcss.config.mjs
COPY web/public /app/web/public

EXPOSE 3000

CMD ["npm", "start", "-w", "web"]

