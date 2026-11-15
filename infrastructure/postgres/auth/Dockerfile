FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
FROM base AS test
RUN npm ci --ignore-scripts
COPY src ./src
COPY test ./test
CMD ["npm", "test"]
FROM base AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
USER node
EXPOSE 4101
CMD ["node", "src/main.mjs"]
