# Production Checklist — DotCom Library + Omnichannel

## Required environment variables

Do not commit real values.

- `NODE_ENV=production`
- `DATABASE_URL`
- `OMNICHANNEL_PORT`
- `PUBLIC_BASE_URL`
- `OMNICHANNEL_PUBLIC_URL`
- `EXISTING_APP_BASE_URL`
- `ALLOWED_ORIGINS`
- `SESSION_BRIDGE_SECRET`
- `ENCRYPTION_KEY`
- `META_WEBHOOK_VERIFY_TOKEN`

## Meta variables

Required before enabling real Meta webhooks:

- `META_APP_SECRET`
- WhatsApp channel account access token stored through the encrypted channel account flow.
- Messenger page access token stored through the encrypted channel account flow.

Meta app credentials are not required while all channel accounts are mock/disabled.

## Recommended URL architecture

Recommended for this project:

- Main app: `https://example.com`
- Omnichannel API under same domain: `https://example.com/omnichannel-api`
- WhatsApp webhook: `https://example.com/webhooks/whatsapp`
- Messenger webhook: `https://example.com/webhooks/messenger`

This avoids CORS complexity for the browser while keeping a stable public webhook URL.

## Security switches

Production defaults should be:

- `FORCE_HTTPS=true`
- `ENABLE_HSTS=true` only after HTTPS is verified.
- `ALLOW_MOCK_IN_PRODUCTION=false`
- `ALLOW_QUERY_SESSION_TOKEN_IN_PRODUCTION=false`
- `OMNI_START_RETRY_WORKER=false` when using a separate worker process.

## Storage

Local storage is allowed in production only with a persistent volume:

- `STORAGE_DRIVER=local`
- `OMNI_UPLOAD_ROOT=/var/lib/dotcom/omnichannel/uploads`

Future object storage variables are prepared:

- `STORAGE_DRIVER=s3`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

## Pre-deployment

1. Take PostgreSQL backup.
2. Confirm `.env.production` is present on server only.
3. Run syntax/tests locally.
4. Deploy code.
5. Run `npm ci --omit=dev`.
6. Run `npm run generate`.
7. Run `npm run migrate:deploy`.
8. Start API + worker.
9. Check `/health`.
10. Check `/ready`.
11. Run smoke test.
