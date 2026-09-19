# CRM Bridge — Bidirectional CRM Sync

**Build with Fastn hackathon · Track 01: CRM Sync Between Two CRMs**

A customer-facing integration that keeps contacts in sync between **Salesforce** and
**Zoho CRM**, in both directions, with duplicate and conflict protection. The customer
connects both CRMs themselves from an embedded widget, and sees a live status view of
what is syncing.

---

## The problem

A business uses two CRMs (for example, sales runs on Salesforce while marketing runs on
Zoho CRM). Records drift apart: someone updates a phone number in one system and the
other still shows the old one. The usual fix is manual exports or an internal script —
work that never ships and breaks silently.

CRM Bridge removes that: connect both CRMs once, and every change flows across in both
directions automatically, with no duplicates.

## What it does

- **Salesforce -> Zoho CRM**: fires in real time on `contact.created` and
  `contact.updated`. A change in Salesforce appears in Zoho within seconds.
- **Zoho CRM -> Salesforce**: polls every 5 minutes (Zoho CRM cannot emit webhooks),
  picks up contacts modified since the last run, and writes them into Salesforce.
- **No duplicates, no blanks, no loops** (see *Correctness* below).
- **Customer-facing widget** where the customer connects both CRMs and sees sync status.

## Architecture

Two Fastn workflows on direct connectors (not the unified API), both on the **Standard**
execution tier.

| Direction | Workflow | Trigger | Key actions |
|---|---|---|---|
| Salesforce -> Zoho CRM | `sync-salesforce-contact-to-zoho` (`wf_467e184300df`) | App event: `contact.created`, `contact.updated` | `salesforce.getContact`, `zohoCrm.searchRecords`, `zohoCrm.createContact`, `zohoCrm.updateContact` |
| Zoho CRM -> Salesforce | `sync-zoho-contact-to-salesforce` (`wf_d8e91b3cccdb`) | Schedule `*/5 * * * *` | `zohoCrm.listContacts`, `salesforce.executeSoqlQuery`, `salesforce.upsertRecord` |

Supporting resources:

- App-event triggers (Salesforce), both `Subscription: Subscribed`.
- Schedule trigger `9b6bbea1-04ea-43fc-915c-8cdd7f4ad14a` for the reverse direction.
- A `fastn.state` cursor (`zoho_to_sf_last_sync`) so each poll only reads changes since
  the previous run.
- A published **widget** scoped to the demo customer (`Connect your CRMs`).

### Data flow

```
Salesforce contact created/updated
  -> App event trigger
  -> workflow wf_467e184300df
       fetch full contact if the event payload is thin
       normalize email (trim + lowercase)
       search Zoho by email
         0 matches  -> create
         1 match    -> update (skip if values already match)
         >1 matches -> stop, report "ambiguous"
  -> Zoho CRM contact

Zoho CRM contact modified
  -> Schedule trigger every 5 min
  -> workflow wf_d8e91b3cccdb
       read cursor, list contacts modified since it
       normalize email
       SOQL lookup in Salesforce
         values already equal -> skip (echo guard)
         otherwise            -> atomic upsert by Email
       advance cursor
  -> Salesforce contact
```

## Field mapping

Only four fields are mapped. Nothing else is read or written.

| Source | Target | Rule |
|---|---|---|
| First Name | First_Name / FirstName | Trimmed; omitted if blank |
| Last Name | Last_Name / LastName | Trimmed; **required** — empty means skip |
| Email | Email | Trimmed + lowercased; **required** — empty means skip; used as the match key |
| Phone | Phone | Trimmed; omitted if blank |

## Correctness: dedup, conflict, loops

This is the part that makes the sync safe to leave running.

1. **Deduplication.** Salesforce -> Zoho searches Zoho by normalized email before writing
   (0 create / 1 update / >1 abort). Zoho -> Salesforce uses the atomic
   `upsertRecord` with `externalIdField: "Email"` — one call that creates or updates with
   no chance of a duplicate.
2. **Conflict handling.** The source only overwrites a mapped field when the incoming
   value is **non-empty**. A blank source value never erases a populated destination
   value, and unrelated destination fields are never touched.
3. **Echo-loop prevention.** Both workflows compare the mapped values before writing. If
   the destination already holds the same values, the workflow returns `skipped` **and
   performs no write** — so the destination's Modified_Time does not advance and the
   reverse poll does not pick the record back up. This is what stops the two directions
   from ping-ponging forever. Proven live: equal values -> `skipped`, changed value ->
   `updated`, immediate re-run -> `skipped`.
4. **Validation.** A record missing email or last name is skipped with a structured
   reason and never written. Ambiguity (two destination contacts sharing an email)
   aborts the write and reports the count rather than guessing.
5. **Structured results.** Every path returns
   `{ status: created|updated|skipped|ambiguous|failed, reason, sourceId, destinationId, timestamp }`,
   so every run is explainable from the Executions log.

## Setup

1. **Connectors** — in Fastn, connect **Salesforce** and **Zoho CRM**
   (`Integrations -> Connections -> New connection`). Both must read **Active**.
2. **Workflows** — open the Agent and describe the two syncs, or use the two workflow
   slugs above if they are already in the workspace.
3. **Triggers**
   - App event on Salesforce: `contact.created` and `contact.updated`, routed to
     `sync-salesforce-contact-to-zoho`. Check the **Subscription** column reads
     `Subscribed` (Status alone is not enough).
   - Schedule `*/5 * * * *` routed to `sync-zoho-contact-to-salesforce`.
4. **Customer** — `Settings -> Customers -> Create customer` (`CRM Bridge Demo`).
5. **Widget** — `Widgets -> INTEGRATIONS -> + Add`, pick Salesforce and Zoho CRM,
   scope **User level**, name it `Connect your CRMs`, then **Save & publish**. Take the
   **Shareable link** (or the **Iframe** snippet) from the **Embed** tab, scoped to the
   demo customer.
6. **Customer experience** — open the widget, click **Connect** next to each CRM, sign in
   once, approve. The status dots turn **Connected** and the Insights tab shows sync
   activity.

## Orbit CRM — the app the widget lives in (Track 01: "inside your app")

Track 01 requires a *"Connect your CRMs" page inside your app*. Fastn's widget alone is
the panel; Orbit CRM is the host product that embeds it.

```
app/
  server.js        Node server, no dependencies (node:http). Serves the app and mints
                   embed tokens server-side so the Fastn API key never reaches the browser.
  public/
    index.html     app shell (sidebar, topbar, views)
    styles.css     modern UI, light/dark
    app.js         navigation + connector cards + widget mount
  start.ps1        Windows launcher (sets the customer + widget URL, runs the server)
```

Run it:

```powershell
powershell -File app\start.ps1
# then open http://localhost:3000  ->  Settings -> Integrations
```

The Integrations page shows Salesforce and Zoho CRM cards with **Connect** buttons and
status dots, and embeds the Fastn hub below them. A real customer clicks Connect, signs
in, and approves — the whole connection flow, inside the product, with no coding.

The token path (`GET /api/embed-token` → Fastn `POST /api/v1/embed/token`) is implemented
and used when `FASTN_HOST` + `FASTN_API_KEY` are set; otherwise the app mounts a Fastn
**shareable widget link**. Either way the customer sees the same hub.

## GitHub Pages deployment

In repository **Settings → Pages**, select **Deploy from a branch**, then **main**
and **/ (root)**. The root `index.html` opens the Orbit CRM app in `app/public/`;
relative asset URLs work under the `/crm-bridge/` project path. `.nojekyll` keeps
Pages from processing the repository as a Jekyll documentation site.

On static hosting, the app falls back to `app/public/config.json`, which contains
the same public Fastn shareable widget link used by `app/start.ps1`. Connection
status is available inside the embedded hub. GitHub Pages cannot run
`app/server.js`, mint embed tokens, or provide the server's live status API.
For those features, run the Node server on a Node-capable host. Never put a
Fastn API key in the static configuration.

## MCP — the agent surface

Fastn's product MCP gateway exposes the workspace's connectors as tools to an AI client.
This deployment (`https://mcp.fastn.dev`) authenticates with **OAuth 2.0** (issuer
`https://connect.fastn.dev`, dynamic client registration, scope `mcp`), not a static key.

```
opencode mcp auth fastn      # -> ✓ fastn connected
```

opencode then sees the native tools (`fastn_list_integrations`,
`fastn_get_integration_status`, `fastn_get_event_history`, `fastn_search_entities`,
`fastn_get_usage_summary`, `fastn_create_flow`) plus dynamic `salesforce_*` / `zoho_*`
tools scoped to the demo customer. This is how the agent inspects and audits the
integration at runtime. See `FASTN_MCP_SETUP.md`.

## Testing

| Test | Expected |
|---|---|
| Create a contact in Salesforce | Appears in Zoho within seconds (`created`) |
| Edit the phone in Salesforce | Zoho updates in place, count stays 1 (`updated`) |
| Edit the phone in Zoho | Salesforce updates within 5 min (`updated`) |
| Re-run with identical values | `skipped`, no write (echo prevention) |
| Contact with blank email | `skipped`, no record created |
| Contact with blank last name | `skipped`, no record created |
| Blank source field | Destination value left untouched |
| Two destination contacts share an email | `ambiguous`, no write |

All of the create / update / skip paths above were demonstrated with **live executions**
against the connected Salesforce and Zoho CRM accounts during the build.

## Limitations (stated honestly)

- **Zoho CRM cannot emit events**, so the Zoho -> Salesforce direction is **polling**
  (up to 5 minutes of latency) rather than real-time. That is a connector limitation, not
  a design choice, and it is visible in the widget as a scheduled sync.
- Contacts are matched **by email**. If an email changes in one system, the change is
  treated as a new contact unless a cross-system external-ID field is added. The
  recommended next step is a `Salesforce_Contact_Id__c` field on Zoho contacts (and the
  mirror) so identity survives an email change.
- The sync moves four contact fields. Companies, deals, and other objects are out of
  scope for this version.
- Multi-tenant behaviour is demonstrated with one demo customer, not a live base of many.

## Team

- Aryan
- Hanzila

Built on Fastn: connectors, triggers, workflows, and the embedded widget, with the
Platform Agent used to build, test, and debug the workflows.
