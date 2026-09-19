"use strict";

const { FASTN_HOST, FASTN_API_KEY, applyCors, json, preflight } = require("./_lib.js");

/*
 * Non-secret runtime configuration for the browser. Never returns the API key
 * or any token. endOrgId is intentionally omitted: the browser receives it with
 * the minted token, so it does not need to be exposed here.
 */
module.exports = function handler(req, res) {
  if (preflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  return json(res, 200, {
    canMintToken: Boolean(FASTN_API_KEY),
    fastnHost: FASTN_HOST,
    connectors: {
      salesforce: { label: "Salesforce", connectorId: "78a2b704-7689-42f1-aacf-379080b124a7" },
      zoho: { label: "Zoho CRM", connectorId: "d2eca9f4-8326-4a28-922c-22c7a7f421d9" },
    },
  });
};
