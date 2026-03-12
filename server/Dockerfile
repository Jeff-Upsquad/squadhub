FROM node:20-alpine AS builder
WORKDIR /app

# Copy all package files for full workspace install
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY desktop/package.json desktop/
COPY mobile/package.json mobile/

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

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/shared/dist/ ./shared/dist/
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/server/dist/ ./server/dist/
COPY --from=builder /app/server/package.json ./server/

EXPOSE 4000

CMD ["node", "server/dist/index.js"]
