"use strict";

const {
  FASTN_API_KEY,
  FASTN_STATUS_API_KEY,
  FASTN_END_ORG_ID,
  applyCors,
  json,
  preflight,
  normalizeList,
  fastnGet,
  fastnGetStatus,
} = require("./_lib.js");

const VERSION = "status-v3";

/*
 * GET /api/status
 *
 * Reads real Fastn state. Connections are scoped to the embed customer
 * (FASTN_END_ORG_ID). Executions are scoped to the embed customer OR the
 * workspace org: for this single-workspace demo the sync workflows are owned by
 * the workspace (personal) org, so that is where their executions land.
 *
 * If the platform cannot be reached the response is { available: false } and the
 * UI degrades to neutral states rather than inventing numbers.
 */

const CONNECTORS = {
  salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
  zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
};

// The org that owns the sync workflows/triggers. For this demo it is the
// workspace org; override with FASTN_WORKSPACE_ORG_ID if it ever changes.
const WORKSPACE_ORG_ID = process.env.FASTN_WORKSPACE_ORG_ID || "personal_3c15292b6ae5e0d20385";

const STATS_ORG_IDS = new Set([FASTN_END_ORG_ID, WORKSPACE_ORG_ID].filter(Boolean));

function startOfTodayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  if (!FASTN_END_ORG_ID) {
    return json(res, 200, { available: false, reason: "FASTN_END_ORG_ID is not configured" });
  }

  const connectors = {};
  for (const [key, def] of Object.entries(CONNECTORS)) {
    connectors[key] = { label: def.label, connected: false, status: "unknown" };
  }

  // Connections must come from the customer-pinned embed key: it resolves the
  // embed customer's own connections. The every-customer status key returns the
  // workspace's connections instead.
  const connResult = await fastnGet("/api/v1/connections");
  if (!connResult.ok) {
    return json(res, 200, {
      available: false,
      reason: connResult.error || `Fastn connections API returned ${connResult.status}`,
      connectors,
    });
  }

  const allConnections = normalizeList(connResult.parsed);
  const connections = allConnections.filter((c) => c.endOrgId === FASTN_END_ORG_ID);
  let connectedCount = 0;
  for (const conn of connections) {
    for (const [key, def] of Object.entries(CONNECTORS)) {
      if (conn.connectorId !== def.connectorId) continue;
      const active = String(conn.status || "").toUpperCase() === "ACTIVE";
      if (active) {
        connectedCount += 1;
        connectors[key] = {
          label: def.label,
          connected: true,
          status: "active",
          verified: conn.verifyStatus ? String(conn.verifyStatus).toUpperCase() === "VERIFIED" : null,
        };
      }
    }
  }

  // Executions are the honest source for "what has synced".
  const execResult = await fastnGetStatus("/api/v1/executions?limit=100");
  let kpis = { syncsToday: null, created: null, updated: null, skipped: null };
  let activity = [];
  let diagnostics = {
    version: VERSION,
    keys: {
      embed: Boolean(FASTN_API_KEY),
      status: Boolean(FASTN_STATUS_API_KEY),
      distinct: FASTN_STATUS_API_KEY !== FASTN_API_KEY,
    },
    connectionsOk: connResult.ok,
    connectionsStatus: connResult.status,
    executionsOk: execResult.ok,
    executionsStatus: execResult.status,
    executionsError: execResult.ok ? null : execResult.error || (execResult.parsed && (execResult.parsed.message || execResult.parsed.error)) || null,
    executionsFetched: 0,
    executionsMatched: 0,
    executionOrgs: [],
    connectionsFetched: allConnections.length,
  };

  if (execResult.ok) {
    const all = normalizeList(execResult.parsed);
    const scoped = all.filter((e) => STATS_ORG_IDS.has(e.endOrgId));
    const today = startOfTodayUtc();
    const todays = scoped.filter((e) => {
      const ts = Date.parse(e.createdAt || e.startedAt || "");
      return Number.isFinite(ts) && ts >= today;
    });
    const statusOf = (e) => (e && e.output && e.output.status) || "";
    kpis = {
      syncsToday: todays.length,
      created: todays.filter((e) => statusOf(e) === "created").length,
      updated: todays.filter((e) => statusOf(e) === "updated").length,
      skipped: todays.filter((e) => statusOf(e) === "skipped").length,
    };
    activity = scoped
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || b.startedAt || 0) - Date.parse(a.createdAt || a.startedAt || 0))
      .slice(0, 5)
      .map((e) => {
        const rec = (e.input && e.input.record) || {};
        return {
          status: statusOf(e) || String(e.status || "").toLowerCase(),
          workflow: e.workflowName || e.workflowSlug || "Sync",
          contact: rec.Name || null,
          at: e.completedAt || e.createdAt || e.startedAt || null,
        };
      });
    diagnostics = {
      version: VERSION,
      keys: {
        embed: Boolean(FASTN_API_KEY),
        status: Boolean(FASTN_STATUS_API_KEY),
        distinct: FASTN_STATUS_API_KEY !== FASTN_API_KEY,
      },
      connectionsOk: connResult.ok,
      connectionsStatus: connResult.status,
      executionsOk: true,
      executionsStatus: execResult.status,
      executionsError: null,
      executionsFetched: all.length,
      executionsMatched: scoped.length,
      executionOrgs: [...new Set(all.map((e) => e.endOrgId).filter(Boolean))],
      connectionsFetched: allConnections.length,
    };
  }

  return json(res, 200, {
    available: true,
    checkedAt: new Date().toISOString(),
    connectedCount,
    connectors,
    kpis,
    activity,
    diagnostics,
  });
};
