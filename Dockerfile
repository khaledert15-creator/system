FROM node:22-alpine

ENV HOST=0.0.0.0 \
    PORT=8765

WORKDIR /app

COPY --chown=node:node app ./app
COPY --chown=node:node server-node.js ./server-node.js

RUN mkdir -p /app/data/backups /app/debug/tracking \
    && chown -R node:node /app/data /app/debug

USER node

EXPOSE 8765
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["node", "server-node.js"]
