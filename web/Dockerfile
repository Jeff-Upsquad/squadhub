FROM node:20-alpine AS builder
WORKDIR /app

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
COPY web/ web/

# Build shared first, then web
ARG INTERNAL_API_URL=http://server:4000
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN npm run build -w shared && npm run build -w web

# ---- Next.js Runtime ----
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY web/package.json web/

# Install only production dependencies
RUN npm install --production

# Copy built app and public files from builder
COPY --from=builder /app/web/.next /app/web/.next
COPY --from=builder /app/web/next.config.mjs /app/web/next.config.mjs
COPY --from=builder /app/web/postcss.config.mjs /app/web/postcss.config.mjs
COPY web/public /app/web/public

EXPOSE 3000

CMD ["npm", "start", "-w", "web"]

