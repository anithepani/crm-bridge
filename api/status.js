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

/*
 * GET /api/status
 *
 * Connections come from the customer-pinned embed key (the embed customer's own
 * connections). Executions come from the every-customer status key, scoped to
 * the embed customer OR the workspace org (where this demo's sync runs land).
 */

const CONNECTORS = {
  salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
  zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
};

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
      if (String(conn.status || "").toUpperCase() === "ACTIVE") {
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

  // The executions endpoint appears to require a customer context; try the
  // workspace org and the embed customer as x-end-org-id, then plain.
  const [execWs, execCust, execPlain] = await Promise.all([
    fastnGetStatus("/api/v1/executions?limit=100", { skipOrg: true, headers: { "x-end-org-id": WORKSPACE_ORG_ID } }),
    fastnGetStatus("/api/v1/executions?limit=100", { skipOrg: true, headers: { "x-end-org-id": FASTN_END_ORG_ID } }),
    fastnGetStatus("/api/v1/executions?limit=100", { skipOrg: true }),
  ]);
  const execResult = [execWs, execCust, execPlain].find((r) => r.ok && normalizeList(r.parsed).length > 0) || execWs;
  const execProbe = { ws: execWs.status, cust: execCust.status, plain: execPlain.status };

  const EXEC_PATHS = [
    "/api/v1/executions?workflowId=wf_467e184300df",
    "/api/v1/executions?endOrgId=" + WORKSPACE_ORG_ID,
    "/api/v1/workflows/wf_467e184300df/executions",
    "/api/v1/workflows/wf_467e184300df",
    "/api/v1/executions?limit=50&offset=0",
  ];
  const execPathResults = await Promise.all(EXEC_PATHS.map((p) => fastnGetStatus(p, { skipOrg: true })));
  const execPaths = {};
  EXEC_PATHS.forEach((p, i) => {
    const r = execPathResults[i];
    const parsed = r.parsed;
    execPaths[p] = {
      status: r.status,
      count: r.ok ? normalizeList(parsed).length : null,
      keys: parsed && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 8) : Array.isArray(parsed) ? "array" : typeof parsed,
    };
  });

  let kpis = { syncsToday: null, created: null, updated: null, skipped: null };
  let activity = [];

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
  }

  return json(res, 200, {
    available: true,
    checkedAt: new Date().toISOString(),
    connectedCount,
    connectors,
    kpis,
    activity,
    diagnostics: {
      embedKey: Boolean(FASTN_API_KEY),
      statusKey: Boolean(FASTN_STATUS_API_KEY),
      distinctKeys: FASTN_STATUS_API_KEY !== FASTN_API_KEY,
      executionsStatus: execResult.status,
      executionsFetched: execResult.ok ? normalizeList(execResult.parsed).length : 0,
      execShape: (() => {
        const p = execResult.parsed;
        return {
          top: Array.isArray(p) ? "array" : typeof p,
          keys: p && typeof p === "object" && !Array.isArray(p) ? Object.keys(p).slice(0, 15) : [],
          dataType: p && !Array.isArray(p) ? (Array.isArray(p.data) ? "array" : typeof p.data) : null,
          dataKeys: p && p.data && !Array.isArray(p.data) ? Object.keys(p.data).slice(0, 15) : [],
          total: p && !Array.isArray(p) ? p.total ?? p.count ?? null : null,
        };
      })(),
      execProbe,
      execPaths,
    },
  });
};
