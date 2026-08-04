#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(process.env.APP_STATIC_SOURCE || path.join(root, "app"));
const outputRoot = path.resolve(process.env.APP_STATIC_OUTPUT || path.join(root, "app-dist"));
const assetSources = ["app.js", "audit-id.js", "purchase-inventory-integrity.js", "order-finance.js", "season-data-management.js", "factory-reset.js", "purchase-stale-retry.js", "styles.css"];

function hash(fileName) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(sourceRoot, fileName))).digest("hex").slice(0, 12);
}

function buildId(value) {
  const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned && cleaned !== "development" && cleaned !== "local" ? cleaned.slice(0, 12) : `local-${hash("app.js")}`;
}

const id = buildId(process.env.APP_BUILD_SHA);
const versionedAssets = assetSources.map(fileName => {
  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  return { source:fileName, versioned:`${baseName}.${id}.${hash(fileName)}${extension}` };
});

fs.rmSync(outputRoot, { recursive:true, force:true });
fs.cpSync(sourceRoot, outputRoot, { recursive:true });

let html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
for (const asset of versionedAssets) {
  fs.copyFileSync(path.join(sourceRoot, asset.source), path.join(outputRoot, asset.versioned));
  const escaped = asset.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(new RegExp(`(["'])${escaped}(?:\\?[^"']*)?\\1`, "g"), (_match, quote) => `${quote}${asset.versioned}${quote}`);
}
const marker = `<meta name="app-build" content="${id}">`;
const runtime = `<script>window.__APP_BUILD__=${JSON.stringify(id)};console.info("Maktabaa System Build:",window.__APP_BUILD__);</script>`;
html = html.replace("<title>", `${marker}\n  <title>`).replace("</head>", `  ${runtime}\n</head>`);
fs.writeFileSync(path.join(outputRoot, "index.html"), html, "utf8");
fs.writeFileSync(path.join(outputRoot, "build-manifest.json"), `${JSON.stringify({ build:id, assets:Object.fromEntries(versionedAssets.map(asset => [asset.source, asset.versioned])) }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ build:id, output:outputRoot, assets:versionedAssets }, null, 2));
