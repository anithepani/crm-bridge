# CRM Bridge — Fastn MCP Connection (opencode)

Project: CRM Bridge — Salesforce ↔ Zoho CRM contact sync.
Hackathon: Build with Fastn, SEECS NUST, 18–19 Sep 2026.

---

## 1. Correction: MCP here is OAuth, not a Bearer key

The Fastn docs say the product MCP gateway (`https://mcp.fastn.dev`) takes
`Authorization: Bearer fsk_...`. **The live deployment does not.** It returns:

```
HTTP 401
WWW-Authenticate: Bearer resource_metadata="https://mcp.fastn.dev/.well-known/oauth-protected-resource"
```

Discovery resolves to a standard OAuth 2.0 authorization server:

- `resource`: `https://mcp.fastn.dev/`
- `authorization_servers`: `["https://connect.fastn.dev"]`
- issuer `https://connect.fastn.dev`, endpoints `/oauth/authorize`, `/oauth/token`,
  `/oauth/register` (Dynamic Client Registration), PKCE `S256`, scope `mcp`.

Static API keys are rejected (401) no matter how they are sent. The gateway wants OAuth.

---

## 2. Working config (`D:\Hackathon\opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "fastn": {
      "type": "remote",
      "url": "https://mcp.fastn.dev",
      "enabled": true
    }
  }
}
```

Notes:
- Do **not** set `oauth: false`, and do **not** add a Bearer `headers` block. Both force
  the wrong auth mode.
- opencode performs DCR + PKCE against `connect.fastn.dev` automatically.
- Config is loaded once at startup — **restart opencode** after editing.

---

## 3. Authenticate

```
opencode mcp auth fastn
```

It registers a client, prints `https://connect.fastn.dev/oauth/authorize?...`, opens the
browser, and waits. Authorize with the Fastn account, then:

```
opencode mcp list      # expect: ✓ fastn connected — https://mcp.fastn.dev
```

`opencode mcp debug fastn` and `opencode mcp logout fastn` are available for
troubleshooting and reset.

---

## 4. What the gateway exposes

Native tools always present:

| Tool | Purpose |
|---|---|
| `fastn_list_integrations` | Active integrations for the customer |
| `fastn_get_integration_status` | Detailed status of one integration |
| `fastn_get_event_history` | Recent events for the customer |
| `fastn_search_entities` | Search entities across integrations |
| `fastn_get_usage_summary` | Quota usage |
| `fastn_create_flow` | Create an automation flow from a spec |

Dynamic tools are generated from connectors the customer has connected — for this
project, `salesforce_*` and `zoho_*` actions. They are tenant-scoped: a call runs against
the customer's credential and cannot reach another customer's data.

The gateway inherits the platform access model, so the **OAuth identity** (your Fastn
user) plus the connector **action scope** (the middle pane's Select all control) decide
what the tools can reach.

---

## 5. Evidence to capture (for the "Use of the Fastn MCP tool" criterion)

- `opencode mcp list` showing `✓ fastn connected`.
- The opencode tool list (native + dynamic tools).
- One real read call, e.g. `fastn_list_integrations` or `fastn_search_entities`.
- The same call reflected in **Activity → Executions** (`Triggered by`) and
  **Settings → Audit log**.

The rubric's 20 points are for **driving the Platform Agent** to build the use case;
the MCP connection is supporting evidence for that same criterion, not a separate 20.
