# Deployment Guide

## A. Traditional Linux VPS deployment

1. Install Node.js 20+, PostgreSQL 15+, Nginx, and optionally PM2.
2. Clone/copy the project.
3. Configure PostgreSQL and create the Omnichannel database.
4. Create `services/omnichannel/.env.production` from `.env.example`.
5. In `services/omnichannel` run:

```bash
npm ci --omit=dev
npm run generate
npm run migrate:deploy
```

6. Start processes with PM2:

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs
pm2 save
```

The PM2 model runs:

- Main app: `server-node.js`
- Omnichannel API: `services/omnichannel/src/server.js`
- Retry worker: `services/omnichannel/src/worker.js`

## B. Docker deployment

Use `docker-compose.production.example.yml` as a template. Copy it and replace placeholder passwords and domains.

```bash
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml exec omnichannel-api npx prisma migrate deploy
```

Docker is optional; traditional deployment remains supported.

## C. PostgreSQL requirements

- Persistent storage.
- Backups enabled.
- Connection string via `DATABASE_URL`.
- Run only `prisma migrate deploy` in production.

## D. Reverse proxy

Use the example:

`deploy/nginx-omnichannel.example.conf`

Important settings:

- SSE: `proxy_buffering off`
- Uploads: `client_max_body_size 12m`
- Webhooks: stable public paths
- Forwarded headers: `X-Forwarded-Proto`, `X-Real-IP`

## E. HTTPS

Enable HTTPS before Meta webhooks.

Recommended:

- `FORCE_HTTPS=true`
- `ENABLE_HSTS=true` after certificate verification.

Do not enable HSTS until the domain and certificate are confirmed.

## F. Environment variables

See `PRODUCTION-CHECKLIST.md`.

## G. Migrations

Production workflow:

1. Backup.
2. Deploy code.
3. `npm run generate`.
4. `npm run migrate:deploy`.
5. `/ready`.
6. Smoke test.

Rollback decision should happen before destructive schema changes. Current Omnichannel migrations are additive for the latest phase.

## H. Startup

Production:

```bash
node server-node.js
cd services/omnichannel && NODE_ENV=production OMNI_START_RETRY_WORKER=false node src/server.js
cd services/omnichannel && NODE_ENV=production node src/worker.js
```

Development one-click:

```cmd
START-ALL.cmd
```

## I. Health and readiness

- `GET /health`: process alive.
- `GET /ready`: database reachable, config valid, channel accounts safe.

`/ready` returns `503` when a critical dependency is not ready.

## J. Backup

Example:

```bash
pg_dump "$DATABASE_URL" --format=custom --file "backup-$(date +%F-%H%M).dump"
```

Restore:

```bash
pg_restore --clean --if-exists --dbname "$DATABASE_URL" backup.dump
```

Recommended:

- Daily backup.
- Keep 14-30 days.
- Always take a pre-migration backup.

## K. Rollback

1. Stop PM2/app containers.
2. Restore previous code.
3. Restore database backup if migration changed data.
4. Start services.
5. Check `/health` and `/ready`.

## L. Meta activation after deployment

Do not connect Meta before HTTPS and public webhook URLs are stable. Follow `META-ACTIVATION-CHECKLIST.md`.
