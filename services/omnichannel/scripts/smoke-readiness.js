const BASE = process.env.OMNI_SMOKE_BASE || process.env.OMNICHANNEL_PUBLIC_URL || "http://127.0.0.1:8775";

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main() {
  const checks = {};
  const health = await json("/health");
  checks.health = health.status === 200 && health.body.ok === true;

  const ready = await json("/ready");
  checks.readyResponds = [200, 503].includes(ready.status);
  const serializedReady = JSON.stringify(ready.body);
  checks.readyNoSecretLeakage = !serializedReady.includes("dev-session-bridge-secret") && !serializedReady.includes("change-this-long-random-secret");
  checks.readyOk = ready.status === 200 && ready.body.ok === true;

  const unknownWebhook = await json("/webhooks/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "unknown-smoke" }, messages: [] } }] }] })
  });
  checks.webhookStable = [200, 401].includes(unknownWebhook.status);

  const pass = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ pass, base: BASE, checks, http: { health: health.status, ready: ready.status, unknownWebhook: unknownWebhook.status } }, null, 2));
  if (!pass) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
