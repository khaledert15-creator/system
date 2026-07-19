FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate && npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=deps /app/prisma ./prisma
COPY src ./src
EXPOSE 8775
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${OMNICHANNEL_PORT:-8775}/health || exit 1
CMD ["node", "src/server.js"]
