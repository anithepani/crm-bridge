"use strict";

const {
  FASTN_END_ORG_ID,
  applyCors,
  json,
  preflight,
  normalizeList,
  fastnGet,
} = require("./_lib.js");

/*
 * GET /api/status
 *
 * Reads real Fastn state, scoped to the embed customer (FASTN_END_ORG_ID) ONLY.
 * The owner's personal-org connections and executions are never returned, which
 * is what stops a visitor from seeing the owner's statistics.
 *
 * If the platform cannot be reached the response is { available: false } and
 * the UI degrades to neutral states rather than inventing numbers.
 */

const CONNECTORS = {
  salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
  zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
};

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

  const connections = normalizeList(connResult.parsed).filter((c) => c.endOrgId === FASTN_END_ORG_ID);
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

  // Executions are the honest source for "what has synced". Scope to the embed
  // customer only; a row without a matching endOrgId is ignored.
  const execResult = await fastnGet("/api/v1/executions?limit=100");
  let kpis = { syncsToday: null, created: null, updated: null, skipped: null };
  let activity = [];

  if (execResult.ok) {
    const today = startOfTodayUtc();
    const scoped = normalizeList(execResult.parsed).filter((e) => e.endOrgId === FASTN_END_ORG_ID);
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
    activity = scoped.slice(0, 5).map((e) => ({
      status: statusOf(e) || String(e.status || "").toLowerCase(),
      workflow: e.workflowName || e.workflowSlug || "Sync",
      at: e.completedAt || e.createdAt || e.startedAt || null,
    }));
  }

  return json(res, 200, {
    available: true,
    checkedAt: new Date().toISOString(),
    connectedCount,
    connectors,
    kpis,
    activity,
  });
};
