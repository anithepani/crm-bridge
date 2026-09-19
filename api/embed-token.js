"use strict";

const { applyCors, json, preflight, readBody, mintEmbedToken } = require("./_lib.js");

/*
 * POST /api/embed-token  { visitorId, userEmail?, userName? }
 *
 * Mints a short-lived Fastn embed token scoped to the visitor. The widget then
 * loads with ?tenant-id=<endOrgId>&token=... so each visitor gets their own
 * user-level connections and never sees another visitor's (or the owner's) data.
 */
module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const body = readBody(req);
  const visitorId = String(body.visitorId || "").trim();
  if (!visitorId || visitorId.length > 128) {
    return json(res, 400, { ok: false, error: "visitorId is required" });
  }

  const short = visitorId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "anon";
  const userEmail = String(body.userEmail || `visitor-${short}@orbit.local`).trim();
  const userName = String(body.userName || `Orbit Visitor ${short}`).trim();

  const result = await mintEmbedToken(userEmail, userName);
  if (!result.ok) {
    return json(res, 502, { ok: false, error: result.error, detail: result.detail || null });
  }
  return json(res, 200, result);
};
