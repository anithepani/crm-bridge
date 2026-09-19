"use strict";

const {
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
 * connections). Executions are read per workflow, which is the path the Fastn
 * API actually serves; the flat /api/v1/executions endpoint returns none.
 */

const CONNECTORS = {
  salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
  zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
};

const WORKFLOWS = [
  { id: "wf_467e184300df", name: "Salesforce → Zoho CRM" },
  { id: "wf_d8e91b3cccdb", name: "Zoho CRM → Salesforce" },
];

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

  const [connResult, ...wfResults] = await Promise.all([
    fastnGet("/api/v1/connections"),
    ...WORKFLOWS.map((w) => fastnGetStatus(`/api/v1/workflows/${w.id}/executions?limit=200`, { skipOrg: true })),
  ]);

  if (!connResult.ok) {
    return json(res, 200, {
      available: false,
      reason: connResult.error || `Fastn connections API returned ${connResult.status}`,
      connectors,
    });
  }

  const allConnections = normalizeList(connResult.parsed);
  const connections = allConnections.filter((c) => c.endOrgId === FASTN_END_ORG_ID);

  // One connector can have several connection records (workspace-level and
  // customer-level). Count distinct connectors, not rows.
  for (const [key, def] of Object.entries(CONNECTORS)) {
    const matches = connections.filter(
      (c) => c.connectorId === def.connectorId && String(c.status || "").toUpperCase() === "ACTIVE"
    );
    if (!matches.length) continue;
    const best = matches.find((c) => c.verifyStatus) || matches[0];
    const verified = best.verifyStatus ? String(best.verifyStatus).toUpperCase() === "VERIFIED" : null;
    const account = best.userEmail || best.userName || null;
    connectors[key] = {
      label: def.label,
      connected: true,
      status: "active",
      verified,
      account,
      instances: matches.length,
    };
  }
  const connectedCount = Object.values(connectors).filter((c) => c.connected).length;

  // Merge executions from every workflow.
  const executions = [];
  wfResults.forEach((r, i) => {
    if (!r.ok) return;
    const rows = normalizeList(r.parsed);
    const name = WORKFLOWS[i] ? WORKFLOWS[i].name : "Sync";
    rows.forEach((e) => executions.push({ ...e, workflowName: e.workflowName || name }));
  });

  const scoped = executions.filter((e) => !STATS_ORG_IDS.size || STATS_ORG_IDS.has(e.endOrgId));
  const usable = scoped.length ? scoped : executions;
  const today = startOfTodayUtc();
  const todays = usable.filter((e) => {
    const ts = Date.parse(e.createdAt || e.startedAt || "");
    return Number.isFinite(ts) && ts >= today;
  });
  const statusOf = (e) => (e && e.output && e.output.status) || "";

  const kpis = {
    syncsToday: todays.length,
    created: todays.filter((e) => statusOf(e) === "created").length,
    updated: todays.filter((e) => statusOf(e) === "updated").length,
    skipped: todays.filter((e) => statusOf(e) === "skipped").length,
  };

  const byNewest = usable
    .slice()
    .sort((a, b) => Date.parse(b.createdAt || b.startedAt || 0) - Date.parse(a.createdAt || a.startedAt || 0));

  const activity = byNewest.slice(0, 5).map((e) => {
    const rec = (e.input && e.input.record) || (e.input && e.input.Email ? e.input : {});
    return {
      status: statusOf(e) || String(e.status || "").toLowerCase(),
      workflow: e.workflowName || "Sync",
      contact: rec.Name || [rec.FirstName, rec.LastName].filter(Boolean).join(" ") || null,
      at: e.completedAt || e.createdAt || e.startedAt || null,
    };
  });

  // Real synced records, harvested from the contact payloads the workflows ran
  // on. Deduplicated by email, newest first.
  const contacts = [];
  const seen = new Set();
  for (const e of byNewest) {
    const rec = (e.input && e.input.record) || (e.input && e.input.Email ? e.input : null);
    if (!rec) continue;
    const email = String(rec.Email || "").trim().toLowerCase();
    const name = rec.Name || [rec.FirstName || rec.First_Name, rec.LastName || rec.Last_Name].filter(Boolean).join(" ");
    if (!name && !email) continue;
    const key = email || name;
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      name: name || "—",
      email: email || "—",
      phone: rec.Phone || "—",
      source: e.workflowName || "Sync",
      status: statusOf(e) || "synced",
    });
    if (contacts.length >= 25) break;
  }

  return json(res, 200, {
    available: true,
    checkedAt: new Date().toISOString(),
    connectedCount,
    connectors,
    kpis,
    activity,
    contacts,
  });
};
