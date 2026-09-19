"use strict";

/*
 * Shared helpers for the Orbit CRM serverless API (Vercel / Node).
 *
 * The Fastn API key lives ONLY here, in the serverless environment. It is never
 * returned to the browser. The browser gets a short-lived, customer-scoped
 * embed token minted per visitor.
 *
 * Required environment variables:
 *   FASTN_API_KEY      Fastn API key (scoped to the embed customer). Secret.
 *   FASTN_END_ORG_ID   Fastn customer UUID the widget is scoped to.
 *
 * Optional:
 *   FASTN_HOST         Fastn API base URL (default https://api.fastn.dev)
 *   FASTN_ORG_ID       Your workspace org id (sent as x-org-id for pinned keys)
 *   ALLOWED_ORIGINS    Comma-separated CORS allowlist (default: GitHub Pages + localhost)
 */

const FASTN_HOST = (process.env.FASTN_HOST || "https://api.fastn.dev").replace(/\/+$/, "");
const FASTN_API_KEY = process.env.FASTN_API_KEY || "";
// Optional separate read-only key used by /api/status. The embed key is pinned
// to one customer; a key scoped to "Every customer" can read the workspace's
// execution history. Falls back to FASTN_API_KEY when unset.
const FASTN_STATUS_API_KEY = process.env.FASTN_STATUS_API_KEY || FASTN_API_KEY;
const FASTN_ORG_ID = process.env.FASTN_ORG_ID || "";
// The embed customer (end-org) UUID. Not a secret; defaults to the CRM Bridge
// Demo customer so only FASTN_API_KEY must be configured on the host.
const FASTN_END_ORG_ID =
  process.env.FASTN_END_ORG_ID || process.env.FASTN_CUSTOMER_ID || "ac8316f8-4f08-4206-8884-27c63cf451af";

const DEFAULT_ORIGINS = ["https://anithepani.github.io", "http://localhost:3000", "http://localhost:5173"];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  let allow = null;
  if (ALLOWED_ORIGINS.includes("*")) allow = origin || "*";
  else if (origin && ALLOWED_ORIGINS.includes(origin)) allow = origin;
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function preflight(req, res) {
  if (req.method === "OPTIONS") {
    applyCors(req, res);
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeList(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && parsed.data && Array.isArray(parsed.data.data)) return parsed.data.data;
  return [];
}

function fastnHeaders(key, extra, opts) {
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    ...(extra || {}),
  };
  // A test key is refused without this header; a live key does not need it.
  if (/^fsk_test_/.test(key)) headers["X-fastn-Test-Mode"] = "true";
  // x-org-id is not sent on token minting: a customer-pinned key takes the
  // customer in the request body instead.
  if (FASTN_ORG_ID && !(opts && opts.skipOrg)) headers["x-org-id"] = FASTN_ORG_ID;
  return headers;
}

async function fastnRequestWithKey(key, method, pathname, body, opts) {
  if (!key) return { ok: false, status: 0, error: "No Fastn API key is configured" };
  try {
    const resp = await fetch(`${FASTN_HOST}${pathname}`, {
      method,
      headers: fastnHeaders(key, body ? { "Content-Type": "application/json" } : undefined, opts),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    return { ok: resp.ok, status: resp.status, parsed, text };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

function fastnRequest(method, pathname, body) {
  return fastnRequestWithKey(FASTN_API_KEY, method, pathname, body);
}

function fastnGet(pathname) {
  return fastnRequest("GET", pathname);
}

// Reads for /api/status use the status key when one is configured.
function fastnGetStatus(pathname) {
  return fastnRequestWithKey(FASTN_STATUS_API_KEY, "GET", pathname);
}

/*
 * Mint a short-lived embed token scoped to the customer, for one visitor.
 * userEmail/userName are what make tenancy user-level: each visitor's
 * connections stay isolated from every other visitor.
 */
async function mintEmbedToken(userEmail, userName) {
  if (!FASTN_END_ORG_ID) return { ok: false, error: "FASTN_END_ORG_ID is not configured" };
  const body = { endOrgId: FASTN_END_ORG_ID };
  if (userEmail) body.userEmail = userEmail;
  if (userName) body.userName = userName;

  const result = await fastnRequestWithKey(FASTN_API_KEY, "POST", "/api/v1/embed/token", body, { skipOrg: true });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error || `Fastn token API returned ${result.status}`,
      detail: (result.parsed && (result.parsed.message || result.parsed.error)) || (result.text || "").slice(0, 200),
    };
  }
  const data = result.parsed && result.parsed.data ? result.parsed.data : result.parsed || {};
  const token = data.token || data.embedToken;
  if (!token) return { ok: false, error: "Fastn token API returned no token" };
  return { ok: true, token, endOrgId: data.endOrgId || FASTN_END_ORG_ID, expiresIn: data.expiresIn || 28800 };
}

module.exports = {
  FASTN_HOST,
  FASTN_API_KEY,
  FASTN_STATUS_API_KEY,
  FASTN_ORG_ID,
  FASTN_END_ORG_ID,
  ALLOWED_ORIGINS,
  applyCors,
  json,
  preflight,
  readBody,
  normalizeList,
  fastnGet,
  fastnGetStatus,
  mintEmbedToken,
};
