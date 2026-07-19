const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createApp, buildContainer } = require("../app");
const { env } = require("../config/env");
const { InMemoryRepository } = require("../repositories/in-memory.repository");

function signedUser(user = { id: "U001", username: "owner", role: "ظ…ط§ظ„ظƒ" }) {
  const header = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.sessionBridgeSecret).update(header).digest("hex");
  return { "X-Omni-User": header, "X-Omni-Signature": signature, "Content-Type": "application/json" };
}

function runtime(repository = new InMemoryRepository()) {
  repository.channelsData = repository.channelsData.length ? repository.channelsData : [
    { id: "ch_whatsapp", key: "whatsapp", name: "WhatsApp", provider: "meta" }
  ];
  const container = buildContainer(repository);
  const server = createApp(container).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl };
}

async function get(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test("health is live and ready reports database/config without leaking secrets", async () => {
  const { server, baseUrl } = runtime();
  try {
    const health = await get(baseUrl, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    const ready = await get(baseUrl, "/ready");
    assert.equal(ready.status, 200);
    const serialized = JSON.stringify(ready.body);
    if (env.sessionBridgeSecret) assert.equal(serialized.includes(env.sessionBridgeSecret), false);
    if (env.encryptionKey) assert.equal(serialized.includes(env.encryptionKey), false);
  } finally {
    server.close();
  }
});

test("ready returns 503 when repository/database is unavailable", async () => {
  const repository = new InMemoryRepository();
  repository.channels = async () => { throw new Error("db down"); };
  const { server, baseUrl } = runtime(repository);
  try {
    const ready = await get(baseUrl, "/ready");
    assert.equal(ready.status, 503);
    assert.equal(ready.body.ok, false);
    assert.equal(ready.body.errors.includes("PostgreSQL is not reachable"), true);
  } finally {
    server.close();
  }
});

test("SSE uses short-lived tickets instead of long-lived query session tokens", async () => {
  const { server, baseUrl } = runtime();
  try {
    const ticketResponse = await fetch(`${baseUrl}/api/events/ticket`, {
      method: "POST",
      headers: signedUser()
    });
    const ticketPayload = await ticketResponse.json();
    assert.equal(ticketResponse.status, 200);
    assert.equal(Boolean(ticketPayload.ticket), true);

    const unauthorized = await get(baseUrl, "/api/events");
    assert.equal(unauthorized.status, 401);
  } finally {
    server.close();
  }
});

test("mock endpoints are disabled unless explicitly allowed", async () => {
  const previousAllow = env.allowMockEndpoints;
  env.allowMockEndpoints = false;
  const { server, baseUrl } = runtime();
  try {
    const response = await fetch(`${baseUrl}/api/mock/whatsapp/incoming`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal([401, 403].includes(response.status), true);
  } finally {
    env.allowMockEndpoints = previousAllow;
    server.close();
  }
});
