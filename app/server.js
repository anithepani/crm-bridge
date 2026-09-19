"use strict";

/*
 * Orbit CRM - local development host for the Fastn "Connect your CRMs" widget.
 * Zero dependencies. Node 18+.
 *
 * In production the static UI is served by GitHub Pages and the API by the
 * serverless functions in /api. This file runs the same API locally by
 * delegating to those exact handlers, so local and deployed behaviour match.
 *
 * Config (environment variables):
 *   FASTN_API_KEY       Fastn API key (server-side only). Required for tokens.
 *   FASTN_END_ORG_ID    Fastn customer UUID the widget is scoped to.
 *   FASTN_HOST          Fastn API base URL (default https://api.fastn.dev)
 *   FASTN_ORG_ID        Workspace org id (optional, for customer-pinned keys)
 *   ALLOWED_ORIGINS     Comma-separated CORS allowlist (optional)
 *   PORT                HTTP port (default 3000)
 */

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const configHandler = require("../api/config.js");
const statusHandler = require("../api/status.js");
const tokenHandler = require("../api/embed-token.js");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === "/api/config") return configHandler(req, res);
  if (p === "/api/status") return statusHandler(req, res);
  if (p === "/api/embed-token") {
    const parsed = await readJsonBody(req);
    req.body = parsed;
    return tokenHandler(req, res);
  }
  if (p === "/api/health") return json(res, 200, { ok: true });

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Method not allowed" });
  }

  return serveStatic(res, p);
});

server.listen(PORT, () => {
  console.log(`Orbit CRM running at http://localhost:${PORT}`);
  console.log(`  token mint: ${process.env.FASTN_API_KEY ? "enabled" : "disabled (set FASTN_API_KEY)"}`);
  console.log(`  customer:   ${process.env.FASTN_END_ORG_ID || process.env.FASTN_CUSTOMER_ID || "(unset)"}`);
});
