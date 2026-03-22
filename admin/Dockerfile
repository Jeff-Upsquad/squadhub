FROM node:20-alpine AS builder
WORKDIR /app

# Copy all package files for full workspace install
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY admin/package.json admin/
COPY desktop/package.json desktop/
COPY mobile/package.json mobile/

# Full install to ensure workspace symlinks are created
RUN npm install

# Copy source
COPY shared/ shared/
COPY admin/ admin/

# Build shared first, then admin
RUN npm run build -w shared && npm run build -w admin

# ---- Next.js Runtime ----
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY admin/package.json admin/

# Install only production dependencies
RUN npm install --production

# Copy built app and public files from builder
COPY --from=builder /app/admin/.next /app/admin/.next
COPY --from=builder /app/admin/next.config.mjs /app/admin/next.config.mjs
COPY --from=builder /app/admin/postcss.config.mjs /app/admin/postcss.config.mjs
COPY admin/public /app/admin/public

EXPOSE 3001

CMD ["npm", "start", "-w", "admin"]

