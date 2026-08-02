#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { execFileSync, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "maktabaa-assets-"));
const cache = new Map();

function pass(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

function copyFixture() {
  fs.cpSync(path.join(root, "app"), path.join(fixture, "app"), { recursive:true });
  fs.cpSync(path.join(root, "data"), path.join(fixture, "data"), { recursive:true });
  fs.copyFileSync(path.join(root, "server-node.js"), path.join(fixture, "server-node.js"));
  fs.appendFileSync(path.join(fixture, "app", "app.js"), "\n// stale-cache-fixture\n");
  fs.appendFileSync(path.join(fixture, "app", "styles.css"), "\n/* stale-cache-fixture */\n");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startServer(port, build) {
  const child = spawn(process.execPath, ["server-node.js"], {
    cwd:fixture,
    env:{ ...process.env, HOST:"127.0.0.1", PORT:String(port), APP_BUILD_SHA:build, NODE_ENV:"production", TRACKING_RPA_ENABLED:"false" },
    stdio:["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  return { child, output:() => output };
}

async function waitForServer(base, running) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (running.child.exitCode !== null) throw new Error(`server exited early: ${running.output()}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${running.output()}`);
}

async function stopServer(running) {
  if (running.child.exitCode !== null) return;
  running.child.kill("SIGTERM");
  await new Promise(resolve => running.child.once("exit", resolve));
}

function referencedAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
}

async function normalReload(base) {
  const indexResponse = await fetch(`${base}/`, { cache:"no-store" });
  const html = await indexResponse.text();
  const assets = referencedAssets(html);
  const bodies = new Map();
  for (const asset of assets) {
    if (!cache.has(asset)) {
      const response = await fetch(`${base}/${asset}`);
      pass(response.ok, `referenced asset exists: ${asset}`);
      cache.set(asset, { body:await response.text(), cacheControl:response.headers.get("cache-control") || "" });
    }
    bodies.set(asset, cache.get(asset).body);
  }
  return { indexResponse, html, assets, bodies };
}

(async () => {
  copyFixture();
  const generatedRoot = path.join(fixture, "generated-assets");
  execFileSync(process.execPath, [path.join(root, "scripts", "build-static-assets.js")], {
    env:{ ...process.env, APP_STATIC_SOURCE:path.join(root, "app"), APP_STATIC_OUTPUT:generatedRoot, APP_BUILD_SHA:"5c08d9984132fc41c63a36aa04235c21e24376fe" },
    stdio:"ignore"
  });
  const generatedManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, "build-manifest.json"), "utf8"));
  pass(generatedManifest.build === "5c08d9984132", "static build manifest contains target build ID");
  for (const [sourceName, versionedName] of Object.entries(generatedManifest.assets)) {
    pass(fs.existsSync(path.join(generatedRoot, versionedName)), `generated ${sourceName} exists with versioned filename`);
  }
  const generatedHtml = fs.readFileSync(path.join(generatedRoot, "index.html"), "utf8");
  pass(Object.values(generatedManifest.assets).every(name => generatedHtml.includes(name)), "generated index references every versioned asset");
  pass(!/(?:src|href)=["'](?:app|styles|order-finance)\.(?:js|css)(?:[?"'])/.test(generatedHtml), "generated index has no legacy main asset reference");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  let running = startServer(port, "old-build-001");
  await waitForServer(base, running);
  const oldPage = await normalReload(base);
  const oldVersionResponse = await fetch(`${base}/api/version`);
  const oldVersion = await oldVersionResponse.json();
  pass(oldVersion.build === "old-build-00", "build ID is generated from APP_BUILD_SHA");
  pass(oldPage.html.includes('<meta name="app-build" content="old-build-00">'), "HTML build marker matches old build");
  pass(oldPage.html.includes('window.__APP_BUILD__="old-build-00"'), "runtime build marker matches old build");
  pass(oldPage.indexResponse.headers.get("cache-control").includes("no-store"), "index.html is never stored");
  pass(oldPage.indexResponse.headers.get("pragma") === "no-cache", "index.html sends Pragma no-cache");
  pass(oldPage.assets.some(name => /^app\.old-build-00\.[a-f0-9]{12}\.js$/.test(name)), "HTML references build- and content-versioned app.js");
  pass(oldPage.assets.some(name => /^styles\.old-build-00\.[a-f0-9]{12}\.css$/.test(name)), "HTML references build- and content-versioned styles.css");
  pass(oldPage.assets.every(name => cache.get(name).cacheControl.includes("immutable")), "versioned assets are immutable");
  const legacyResponse = await fetch(`${base}/app.js`);
  pass(!String(legacyResponse.headers.get("cache-control")).includes("immutable"), "legacy asset is not immutable");
  await stopServer(running);

  fs.copyFileSync(path.join(root, "app", "app.js"), path.join(fixture, "app", "app.js"));
  fs.copyFileSync(path.join(root, "app", "styles.css"), path.join(fixture, "app", "styles.css"));
  running = startServer(port, "5c08d9984132fc41c63a36aa04235c21e24376fe");
  await waitForServer(base, running);
  const newPage = await normalReload(base);
  const newVersionResponse = await fetch(`${base}/api/version`);
  const newVersion = await newVersionResponse.json();
  pass(newVersion.build === "5c08d9984132", "version endpoint exposes the target build only");
  pass(newVersion.environment === "production", "version endpoint exposes safe environment label");
  pass(newPage.html.includes('<meta name="app-build" content="5c08d9984132">'), "HTML marker changed on normal reload");
  pass(newPage.html.includes('window.__APP_BUILD__="5c08d9984132"'), "runtime marker changed on normal reload");
  const oldApp = oldPage.assets.find(name => name.startsWith("app."));
  const newApp = newPage.assets.find(name => name.startsWith("app."));
  const oldCss = oldPage.assets.find(name => name.startsWith("styles."));
  const newCss = newPage.assets.find(name => name.startsWith("styles."));
  pass(oldApp !== newApp, "changing app content changes its asset URL");
  pass(oldCss !== newCss, "changing CSS content changes its asset URL");
  pass(newPage.bodies.get(newApp).includes("renderQuickOrderPreservingContext"), "new runtime contains scroll/focus fix");
  pass(newPage.bodies.get(newApp).includes("normalizeArabicNumericText"), "new runtime contains Arabic/Persian normalization");
  pass(newPage.bodies.get(newApp).includes("online-orders-master-table"), "new runtime contains All Orders master list");
  pass(!newPage.assets.includes(oldApp) && !newPage.assets.includes(oldCss), "new HTML never references stale assets");
  pass(cache.has(oldApp) && cache.has(newApp), "normal browser cache retains old URL without reusing it");
  await stopServer(running);
  console.log(JSON.stringify({ oldAssets:oldPage.assets, newAssets:newPage.assets, build:newVersion.build }, null, 2));
})().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
