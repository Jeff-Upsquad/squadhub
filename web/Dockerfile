FROM node:20-alpine AS builder
WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY web/package.json web/

# Install dependencies
RUN npm install --workspace=shared --workspace=web

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
