'use strict';
// The whole-database save (PUT /api/db) is gzip-compressed by the browser: the server accepts it with the header, or
// without it when a proxy dropped the header, refuses a corrupt body with a clear code, and the browser falls back to
// the uncompressed save when the compressed one is refused. Runs a scratch System and the real browser functions.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const H = require('./integration-test-helpers.js');
const pass = name => console.log(`PASS ${name}`);

const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let parens = 0, j = source.indexOf('(', start);
  for (; j < source.length; j++) { if (source[j] === '(') parens++; else if (source[j] === ')' && --parens === 0) break; }
  let depth = 0, i = source.indexOf('{', j);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  const asyncPrefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return asyncPrefix + source.slice(start, i + 1);
}

(async () => {
  let system;
  try {
    system = await H.startSystem({ name: 'db-compression-' });
    const token = await system.login('owner');
    const put = async (body, headers = {}) => {
      const db = await (await fetch(`${system.base}/api/db`, { headers: { 'X-Session-Token': token } })).json();
      const revision = String(db.meta?.dataRevision ?? '');
      return { db, revision, response: await fetch(`${system.base}/api/db`, { method: 'PUT', headers: { 'X-Session-Token': token, 'Content-Type': 'application/json', 'If-Match': revision, ...headers }, body: body(db) }) };
    };
    let { response } = await put(db => { db.settings.companyName = 'مضغوط'; return zlib.gzipSync(JSON.stringify(db)); }, { 'Content-Encoding': 'gzip' });
    assert.equal(response.status, 200, await response.text());
    assert.equal(system.readDb().settings.companyName, 'مضغوط');
    pass('a gzip-compressed save is accepted and stored');

    ({ response } = await put(db => { db.settings.companyName = 'بدون رأس'; return zlib.gzipSync(JSON.stringify(db)); }));
    assert.equal(response.status, 200);
    assert.equal(system.readDb().settings.companyName, 'بدون رأس');
    pass('compressed bytes are recognised when a proxy dropped the header');

    ({ response } = await put(db => { db.settings.companyName = 'عادي'; return JSON.stringify(db); }));
    assert.equal(response.status, 200); assert.equal(system.readDb().settings.companyName, 'عادي');
    pass('an uncompressed save still works');

    ({ response } = await put(() => Buffer.from([0x1f, 0x8b, 1, 2, 3]), { 'Content-Encoding': 'gzip' }));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_COMPRESSED_BODY');
    ({ response } = await put(db => JSON.stringify(db), { 'Content-Encoding': 'br' }));
    assert.equal(response.status, 415); assert.equal((await response.json()).code, 'UNSUPPORTED_ENCODING');
    assert.equal(system.readDb().settings.companyName, 'عادي', 'nothing saved by a refused body');
    assert.match(system.output(), /"operationType":"DB_SAVE_TIMING".*"compressed":true/);
    pass('a corrupt or unknown encoding is refused with a clear code, and save timing is logged');

    // The browser side: compresses, and falls back to the plain save when the compressed one is refused.
    const calls = [];
    const sandbox = { CompressionStream, Response, Blob, AbortSignal, console, data: { books: [], sales: [], settings: { companyName: 'x' } }, dbRevision: '7', saveConflict: false, lastSaveError: null, lastSuccessfulSaveAt: '',
      authHeaders: headers => headers, showAppUpdateBanner() {}, showLogin() {},
      fetch: async (url, options) => { calls.push(options); const plain = !options.headers['Content-Encoding']; const status = calls.length === 1 && sandbox.refuse ? 415 : 200;
        return new Response(JSON.stringify(status === 200 ? { ok: true, revision: '8' } : { ok: false, code: 'UNSUPPORTED_ENCODING' }), { status, headers: { 'X-DB-Revision': plain || status === 200 ? '8' : '' } }); } };
    vm.createContext(sandbox);
    vm.runInContext(`let compressedSaveRefused=false;\n${extract('gzipText')}\n${extract('persistToServer')}`, sandbox);
    await vm.runInContext('persistToServer()', sandbox);
    assert.equal(calls.length, 1); assert.equal(calls[0].headers['Content-Encoding'], 'gzip');
    assert.deepEqual(JSON.parse(zlib.gunzipSync(Buffer.from(calls[0].body)).toString()), sandbox.data);
    calls.length = 0; sandbox.refuse = true;
    vm.runInContext('compressedSaveRefused=false', sandbox);
    await vm.runInContext('persistToServer()', sandbox);
    assert.equal(calls.length, 2, 'refused compressed save is sent again uncompressed'); assert.equal(calls[1].headers['Content-Encoding'], undefined);
    assert.equal(typeof calls[1].body, 'string');
    calls.length = 0; sandbox.refuse = false;
    await vm.runInContext('persistToServer()', sandbox);
    assert.equal(calls[0].headers['Content-Encoding'], undefined, 'after a refusal the session keeps saving uncompressed');
    pass('the browser compresses the save and falls back to the plain save once refused');

    const real = path.join(__dirname, '../data/database.json');
    if (fs.existsSync(real)) { const raw = fs.readFileSync(real); console.log(`INFO this database: ${raw.length} bytes → ${zlib.gzipSync(raw).length} compressed`); }
    console.log('db save compression: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-20).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); }
})();
