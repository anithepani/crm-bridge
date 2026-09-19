"use strict";

/*
 * Orbit CRM - demo SaaS host for the Fastn "Connect your CRMs" widget.
 * Zero dependencies. Node 18+.
 *
 * It serves the app UI, mints Fastn embed tokens server-side (so the Fastn API
 * key never reaches the browser) and reports live connector status through
 * /api/status by querying the Fastn API on the server.
 *
 * Config (environment variables, all optional):
 *   FASTN_HOST          Fastn API base URL, e.g. https://api.fastn.dev
 *   FASTN_APP_URL       Fastn dashboard URL for deep links (default https://app.fastn.dev)
 *   FASTN_API_KEY       Fastn API key used to mint tokens and read connection status
 *   FASTN_CUSTOMER      Customer slug the widget is scoped to (default crm-bridge-demo)
 *   FASTN_CUSTOMER_ID   Customer (end-org) UUID the token/status is scoped to
 *   WIDGET_URL          A Fastn shareable widget link; if set, embedded directly
 *   PORT                HTTP port (default 3000)
 */

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const FASTN_HOST = (process.env.FASTN_HOST || "https://api.fastn.dev").replace(/\/+$/, "");
const FASTN_APP_URL = (process.env.FASTN_APP_URL || "https://app.fastn.dev").replace(/\/+$/, "");
const FASTN_API_KEY = process.env.FASTN_API_KEY || "";
const FASTN_CUSTOMER = process.env.FASTN_CUSTOMER || "crm-bridge-demo";
const FASTN_CUSTOMER_ID = process.env.FASTN_CUSTOMER_ID || "ac8316f8-4f08-4206-8884-27c63cf451af";
const WIDGET_URL = process.env.WIDGET_URL || "";

// The connectors this demo bridges, keyed by the id used in the UI.
const CONNECTORS = {
  salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
  zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
};

// The Fastn workflows that keep the two CRMs in sync (dashboard deep links).
const WORKFLOWS = [
  {
    id: "wf_467e184300df",
    name: "Salesforce → Zoho CRM",
    key: "salesforceToZoho",
  },
  {
    id: "wf_d8e91b3cccdb",
    name: "Zoho CRM → Salesforce",
    key: "zohoToSalesforce",
  },
];

function workflowLink(id) {
  return `${FASTN_APP_URL}/integrations?tab=workflows&workflow=${encodeURIComponent(id)}`;
}

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

async function fastnGet(pathname) {
  const resp = await fetch(`${FASTN_HOST}${pathname}`, {
    headers: {
      Authorization: `Bearer ${FASTN_API_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await resp.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  return { ok: resp.ok, status: resp.status, parsed, text };
}

/*
 * Live connection status for the demo customer, read from the Fastn API with
 * the server-side key. Results are cached briefly so the UI can poll cheaply.
 */
let statusCache = { at: 0, value: null };
const STATUS_TTL_MS = 5000;

async function fetchConnectionStatus() {
  if (!FASTN_API_KEY) {
    return { available: false, reason: "FASTN_API_KEY is not configured", connectors: {} };
  }
  if (statusCache.value && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return statusCache.value;
  }

  const connectors = {};
  for (const [key, def] of Object.entries(CONNECTORS)) {
    connectors[key] = { label: def.label, connected: false, status: "unknown" };
  }

  let connections = [];
  try {
    const { ok, status, parsed, text } = await fastnGet("/api/v1/connections");
    if (!ok) {
      const value = {
        available: false,
        reason: `Fastn connections API returned ${status}`,
        detail: (parsed && (parsed.message || parsed.error)) || text.slice(0, 200),
        connectors,
      };
      statusCache = { at: Date.now(), value };
      return value;
    }
    connections = Array.isArray(parsed) ? parsed : (parsed && parsed.data) || [];
  } catch (err) {
    const value = { available: false, reason: `Could not reach Fastn: ${err.message}`, connectors };
    statusCache = { at: Date.now(), value };
    return value;
  }

  for (const conn of connections) {
    if (conn.endOrgId && conn.endOrgId !== FASTN_CUSTOMER_ID) continue;
    for (const [key, def] of Object.entries(CONNECTORS)) {
      if (conn.connectorId !== def.connectorId) continue;
      const active = String(conn.status || "").toUpperCase() === "ACTIVE";
      const verified = conn.verifyStatus ? String(conn.verifyStatus).toUpperCase() : null;
      if (active) {
        connectors[key] = {
          label: def.label,
          connected: true,
          status: "active",
          verified: verified === null ? null : verified === "VERIFIED",
          connectionName: conn.name || "default",
        };
      } else if (connectors[key].status === "unknown") {
        connectors[key] = { label: def.label, connected: false, status: String(conn.status || "unknown").toLowerCase() };
      }
    }
  }

  const value = { available: true, checkedAt: new Date().toISOString(), connectors };
  statusCache = { at: Date.now(), value };
  return value;
}

async function mintEmbedToken() {
  if (!FASTN_HOST || !FASTN_API_KEY) {
    return { ok: false, error: "FASTN_HOST and FASTN_API_KEY are not configured" };
  }
  const url = `${FASTN_HOST}/api/v1/embed/token`;
  const body = JSON.stringify({ endOrgId: FASTN_CUSTOMER_ID });
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FASTN_API_KEY}`,
        "X-fastn-Test-Mode": "true",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: `Fastn token API returned ${resp.status}`,
        detail: (parsed && (parsed.message || parsed.error)) || text.slice(0, 200),
      };
    }
    const data = parsed && parsed.data ? parsed.data : parsed;
    const token = data && (data.token || data.embedToken);
    if (!token) {
      return { ok: false, error: "Fastn token API returned no token", detail: text.slice(0, 200) };
    }
    return { ok: true, token, expiresIn: (data && data.expiresIn) || 28800 };
  } catch (err) {
    return { ok: false, error: `Could not reach Fastn: ${err.message}` };
  }
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

  if (p === "/api/config") {
    return json(res, 200, {
      customer: FASTN_CUSTOMER,
      customerId: FASTN_CUSTOMER_ID,
      widgetUrl: WIDGET_URL,
      canMintToken: Boolean(FASTN_HOST && FASTN_API_KEY),
      fastnHost: FASTN_HOST,
      fastnAppUrl: FASTN_APP_URL,
      connectors: Object.fromEntries(
        Object.entries(CONNECTORS).map(([k, v]) => [k, { label: v.label, connectorId: v.connectorId }])
      ),
      workflows: WORKFLOWS.map((w) => ({ id: w.id, key: w.key, name: w.name, url: workflowLink(w.id) })),
    });
  }

  if (p === "/api/status") {
    const status = await fetchConnectionStatus();
    return json(res, 200, status);
  }

  if (p === "/api/embed-token") {
    const result = await mintEmbedToken();
    return json(res, result.ok ? 200 : 502, result);
  }

  if (p === "/api/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Method not allowed" });
  }

  return serveStatic(res, p);
});

server.listen(PORT, () => {
  const minting = FASTN_HOST && FASTN_API_KEY ? "enabled" : "disabled (set FASTN_HOST + FASTN_API_KEY)";
  console.log(`Orbit CRM running at http://localhost:${PORT}`);
  console.log(`  customer:   ${FASTN_CUSTOMER} (${FASTN_CUSTOMER_ID})`);
  console.log(`  token mint: ${minting}`);
  console.log(`  status API: ${FASTN_API_KEY ? "enabled" : "disabled (set FASTN_API_KEY)"}`);
  console.log(`  widget url: ${WIDGET_URL || "(none, uses embed token)"}`);
});
