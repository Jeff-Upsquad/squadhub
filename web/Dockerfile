FROM node:20-alpine AS builder
WORKDIR /app

# Build args for Vite env vars (baked in at build time)
ARG VITE_ADMIN_URL
ENV VITE_ADMIN_URL=$VITE_ADMIN_URL

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
COPY web/ web/

# Build shared first, then web
RUN npm run build -w shared && npm run build -w web

# ---- Serve with Nginx ----
FROM nginx:alpine

# Copy custom nginx config
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files
COPY --from=builder /app/web/dist /usr/share/nginx/html

EXPOSE 80
