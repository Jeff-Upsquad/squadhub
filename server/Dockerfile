FROM node:20-alpine AS builder
WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/

# Install dependencies
RUN npm install --workspace=shared --workspace=server

# Copy source
COPY shared/ shared/
COPY server/ server/

# Build
RUN npm run build -w shared && npm run build -w server

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
