'use strict';
// Service-to-service HMAC (INTEGRATION_API_SPEC.md §1): the shared test vector, verification rules and config parsing.
const assert = require('node:assert/strict');
const Auth = require('../app/integration-auth.js');

// The fixed test vector both suites (Store and System) must reproduce byte for byte.
const vector = Auth.integrationSignature({ secret:'test-secret-0123456789abcdef0123456789', timestamp:'1792500000', nonce:'n0nce-test-000001', method:'POST', pathWithQuery:'/api/integration/v1/orders/MK261020-12345/sales-link', body:'{"salesOrderId":"ORD-0201"}' });
assert.equal(vector, 'v1=38367ca73e718b0533561b805dd3722e768284332b837600fcbfd7fedc50d167');
assert.equal(Auth.integrationSignature({ secret:'test-secret-0123456789abcdef0123456789', timestamp:'1792500000', nonce:'n0nce-test-000001', method:'post', pathWithQuery:'/api/integration/v1/orders/MK261020-12345/sales-link', body:Buffer.from('{"salesOrderId":"ORD-0201"}') }), vector, 'method is upper-cased and a Buffer body hashes the same');
console.log('PASS spec test vector v1=38367ca7…d167');

const secret = 'a-very-long-shared-secret-0123456789abcdef', previous = 'the-previous-shared-secret-0123456789abcdef';
const now = 1792500000 * 1000;
const sign = (overrides = {}) => {
  const input = { secret, keyId:'store-v1', method:'GET', pathWithQuery:'/api/integration/v1/catalog', body:'', now, nonce:`nonce-${Math.random().toString(36).slice(2, 14)}xx`, ...overrides };
  return { headers:Object.fromEntries(Object.entries(Auth.signedHeaders(input)).map(([k, v]) => [k.toLowerCase(), v])), input };
};
const verify = (headers, overrides = {}) => Auth.verifyRequest({ headers, method:'GET', pathWithQuery:'/api/integration/v1/catalog', body:'', secrets:[secret, previous], acceptedKeyIds:['store-v1'], nonceCache:cache, now, ...overrides });
let cache = Auth.createNonceCache();

const good = sign();
assert.deepEqual(verify(good.headers), { ok:true, keyId:'store-v1' });
assert.equal(verify(good.headers).reason, 'replayed', 'the same nonce is refused within 600 s');
console.log('PASS valid signature accepted once, replay refused');

cache = Auth.createNonceCache();
assert.equal(verify({}).reason, 'unknown_key');
assert.equal(verify({ ...sign().headers, 'x-maktabaa-key-id':'other-v1' }).reason, 'unknown_key');
assert.equal(verify({ ...sign().headers, 'x-maktabaa-signature':undefined }).reason, 'malformed');
assert.equal(verify({ ...sign().headers, 'x-maktabaa-nonce':'short' }).reason, 'malformed', 'nonce must be 16–64 URL-safe chars');
assert.equal(verify({ ...sign().headers, 'x-maktabaa-nonce':'x'.repeat(65) }).reason, 'malformed');
assert.equal(verify(sign({ now:now - 301000 }).headers).reason, 'stale', 'more than 300 s in the past');
assert.equal(verify(sign({ now:now + 301000 }).headers).reason, 'stale', 'more than 300 s in the future');
assert.equal(verify(sign({ now:now - 299000 }).headers).ok, true, 'inside the window');
assert.equal(verify(sign({ secret:'wrong-secret-0123456789abcdef0123456789' }).headers).reason, 'bad_signature');
assert.equal(verify(sign({ pathWithQuery:'/api/integration/v1/catalog?x=1' }).headers).reason, 'bad_signature', 'path and query are signed');
assert.equal(verify(sign({ body:'{"a":1}' }).headers).reason, 'bad_signature', 'body hash is signed');
assert.equal(verify(sign({ method:'POST' }).headers).reason, 'bad_signature', 'method is signed');
assert.equal(verify(sign({ secret:previous }).headers).ok, true, 'previous secret accepted during rotation');
assert.equal(Auth.verifyRequest({ headers:sign().headers, method:'GET', pathWithQuery:'/api/integration/v1/catalog', secrets:[], acceptedKeyIds:['store-v1'], now }).reason, 'not_configured');
console.log('PASS unknown key, malformed, stale (±300 s), bad signature and rotation rules');

// Config: everything optional, short secrets disable the integration, values are never echoed.
const logged = [];
let config = Auth.configFromEnv({}, event => logged.push(event));
assert.equal(config.enabled, false); assert.equal(config.storeEnabled, false);
assert.equal(config.keyId, 'system-v1'); assert.equal(config.peerKeyId, 'store-v1'); assert.equal(config.chatwoodOrigin, 'https://chat.maktabaa.com');
config = Auth.configFromEnv({ INTEGRATION_SHARED_SECRET:'too-short' }, event => logged.push(event));
assert.equal(config.enabled, false);
assert.ok(!JSON.stringify(logged).includes('too-short'), 'secret value never logged');
config = Auth.configFromEnv({ INTEGRATION_SHARED_SECRET:secret, INTEGRATION_SHARED_SECRET_PREVIOUS:previous, STORE_INTEGRATION_BASE_URL:'http://maktaba-store-api:5001/ignored/path', CHATWOOD_ORIGIN:'https://chat.example.test', INTEGRATION_KEY_ID:'system-v2' });
assert.deepEqual(config.secrets, [secret, previous]); assert.equal(config.enabled, true); assert.equal(config.storeEnabled, true);
assert.equal(config.storeBaseUrl, 'http://maktaba-store-api:5001'); assert.equal(config.chatwoodOrigin, 'https://chat.example.test'); assert.equal(config.keyId, 'system-v2');
assert.equal(Auth.configFromEnv({ CHATWOOD_ORIGIN:'https://chat.example.test/path' }).chatwoodOrigin, 'https://chat.maktabaa.com', 'a non-origin falls back to the default');
console.log('PASS optional env configuration');
console.log('PASS integration auth checks completed');
