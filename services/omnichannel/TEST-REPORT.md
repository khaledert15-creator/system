# Omnichannel TEST REPORT

Date: 2026-07-09

## Automated checks executed

- `node --check app/app.js`
- `node --check services/omnichannel/src/app.js`
- `node --check services/omnichannel/src/repositories/in-memory.repository.js`
- `Get-ChildItem services/omnichannel/src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`
- `node --test src/tests/*.test.js`

## Result

All syntax checks passed.

Unit tests: 7 passed / 0 failed.

## Covered scenarios

1. Normalize Egyptian phone numbers before contact matching.
2. Generate phone search variants for local and international formats.
3. Verify Meta style HMAC webhook signatures.
4. Reject unsafe signature comparison with different string lengths.
5. Create a WhatsApp inbound conversation from a mock provider.
6. Link an inbound conversation to existing customer/order/invoice/shipment IDs by phone.
7. Prevent duplicate inbound provider messages with the same external message id.
8. Claim a conversation using optimistic version locking.
9. Reject stale claim attempts to reduce multi-agent reply conflicts.
10. Send outbound replies through the mock provider and record delivery status.

## Runtime E2E: Multi-Agent Concurrency

Date: 2026-07-09

Command:

```bash
node scripts/e2e-concurrency-runtime.js
```

Runtime prerequisites:

- DotCom app on `http://127.0.0.1:8765`
- Omnichannel service on `http://127.0.0.1:8775`
- PostgreSQL using the configured `DATABASE_URL`

Result: PASS.

Users used:

- Supervisor: `owner / U001`
- Agent A: `cashier / U004`
- Agent B: `shipping / U006`

Verified:

1. First claim succeeds for Agent A.
2. Stale claim by Agent B fails with HTTP 409.
3. Assigned user remains Agent A after stale claim.
4. Unauthorized reply by Agent B is blocked with HTTP 403.
5. Authorized reply by Agent A succeeds and stores `sentByUserId`, `externalMessageId`, and delivery history.
6. Supervisor transfer from Agent A to Agent B succeeds.
7. Stale transfer using the old version fails with HTTP 409.
8. Assigned user remains Agent B after stale transfer.
9. Old Agent A is blocked after transfer.
10. New Agent B can reply successfully.
11. Double reply race accepts only the authorized Agent B reply.
12. PostgreSQL verification confirmed no duplicate outbound `clientMessageId`.
13. `conversation_assignments`, `conversation_events`, `messages`, `message_delivery_statuses`, and `agent_activity_logs` were written correctly.

Bug found and fixed:

- `POST /api/conversations/:id/assign` previously ignored the submitted `version`, allowing stale transfer overwrite.
- Fix: assignment now passes `expectedVersion` through the route/service/repository and uses atomic optimistic locking before writing assignment history.

## Manual setup still required for full local runtime

- PostgreSQL must be running.
- Copy `.env.example` to `.env` and set `DATABASE_URL`.
- Run Prisma migration and seed:

```bash
npm run migrate
npm run seed
```

Then start:

```bash
npm run dev
```

## Channel Account Management + Multi-Account Routing

Date: 2026-07-10

Implemented:

- Channel Account CRUD API:
  - `GET /api/channel-accounts`
  - `GET /api/channel-accounts/:id`
  - `POST /api/channel-accounts`
  - `PATCH /api/channel-accounts/:id`
  - `POST /api/channel-accounts/:id/activate`
  - `POST /api/channel-accounts/:id/deactivate`
  - `DELETE /api/channel-accounts/:id` soft delete
  - `POST /api/channel-accounts/:id/test-connection`
  - `GET /api/channel-accounts/:id/connection-status`
- Server-side permissions for channel administration.
- `agent_activity_logs` entries for create/update/activate/deactivate/delete/test.
- `channel_accounts` production fields:
  - `connection_status`
  - `is_critical`
  - `last_tested_at`
  - `last_connected_at`
  - `last_error`
- `channel_account_credentials` encrypted credential storage.
- Credential masking; full token is never returned by API.
- WhatsApp webhook routing by `metadata.phone_number_id`.
- Messenger webhook routing by `entry.id` page id.
- Unknown WhatsApp/Messenger account no longer falls back to the first active account.
- Outbound replies resolve the provider from `conversation.channelAccountId`.
- WhatsApp status callbacks for `delivered`, `read`, and `failed`.
- Idempotent duplicate status callback behavior.
- Omnichannel UI channel management table and add/edit/test/activate/deactivate/delete actions.
- Inbox channel-account filter sourced from API accounts.

Database migration:

- `prisma/migrations/202607100001_channel_account_management/migration.sql`

Automated checks:

- `node --check` for `src/**/*.js`
- `node --check` for `scripts/*.js`
- `node --check ../../app/app.js`
- `npm test`

Unit/integration result:

- 14 passed / 0 failed.

Runtime PostgreSQL E2E:

Command:

```bash
npm run test:e2e:channels
```

Verified on runtime service + PostgreSQL:

1. WhatsApp Test Account 3 with `phone_number_id = test-phone-id-3` routes to Account 3.
2. WhatsApp Test Account 4 with `phone_number_id = test-phone-id-4` routes to Account 4.
3. WhatsApp 3 and WhatsApp 4 do not cross-route.
4. Unknown WhatsApp `phone_number_id` is ignored without fallback.
5. Messenger Page 2 with `page_id = test-page-2` routes to Page 2.
6. Unknown Messenger `page_id` is ignored without fallback.
7. Outbound reply uses the conversation channel account.
8. WhatsApp `delivered`, `read`, and `failed` callbacks update message status.
9. Duplicate delivered callback does not duplicate delivery history.

Runtime E2E result: PASS.
