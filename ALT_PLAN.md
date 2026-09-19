# CRM Bridge — Working Plan

Track 01: CRM Sync Between Two CRMs.
Pair chosen: **Salesforce <-> Zoho CRM** (both connected, both managed OAuth).
HubSpot dropped: its community connector is read-only and its built-in OAuth app has an
invalid client secret (`BAD_CLIENT_SECRET` / `invalid_client`). Escalated to organisers.

## Status
- [x] Step 1: HubSpot broken -> pivot
- [x] Step 2: Salesforce connected (Active)
- [x] Step 3: Zoho CRM connected (Active)
- [x] Step 4: Built + live-tested workflow **wf_467e184300df** (`sync-salesforce-contact-to-zoho`, v1 published)
- [x] Step 5: App event trigger bound on `contact.created`, **Subscription: Subscribed**. PROVEN end to end: a real Salesforce contact (not manually triggered) appeared in Zoho CRM. Proof run `exec_d9e06db9a6ff`.
- [x] Step 6a: Update trigger (`contact.updated`) bound + update sync proven
- [x] Step 6b: Reverse workflow **wf_d8e91b3cccdb** (`sync-zoho-contact-to-salesforce`), schedule trigger `9b6bbea1-04ea-43fc-915c-8cdd7f4ad14a` (`*/5 * * * *`), echo-loop guard, atomic upsert by Email. Live-tested.
- [x] Step 6c: Widget built + published (Salesforce + Zoho, User level, `Connect your CRMs`)
- [x] Step 6d: Echo loop stopped; bidirectional sync proven both ways
- [x] Orbit CRM app built (`D:\Hackathon\app`) embedding the widget (closes the "inside your app" gap). Run: `powershell -File app\start.ps1` → http://localhost:3000 → Settings → Integrations
- [x] MCP: gateway is **OAuth** (connect.fastn.dev), NOT a Bearer key. `opencode mcp auth fastn` → `✓ fastn connected`
- [ ] Step 8: Screenshots, 2-min video, submit (before 3:30 PM)
- [ ] Step 9: Use fastn_* MCP tools in a restarted opencode + capture evidence
- [x] Echo-loop guard added to forward workflow (v3, live-proven)

Fastn API host: `https://api.fastn.dev` (discovered via the widget shareable link).
MCP host: `https://mcp.fastn.dev` (OAuth issuer `https://connect.fastn.dev`).

## Step 4 — Platform Agent prompts (copy-paste into a new Agent session)

### Prompt A — Inspect (creates nothing)
Inspect this workspace and report only what already exists. Do not create, modify or
delete anything. For each of the Zoho CRM and Salesforce connectors, list the exact
actions available (names and slugs) for creating, searching and updating a contact.
State whether each connector has an app-event trigger defined, and which contact
events it can raise. Say for each answer whether you read it from the platform or are
inferring. Do not guess action names. Then tell me the minimum set of actions needed
to sync a contact from one CRM to the other, and any missing piece.

### Inspection results (from Prompt A)
- Zoho CRM: slug `zohoCrm`. Actions `createContact`, `searchRecords`, `listContacts`,
  `getRecord`, `updateContact`. NO events, NO webhook config -> cannot raise events.
- Salesforce: slug `salesforce`. Actions `createContact`, `upsertRecord` (by
  External Id or Contact.Email), `executeSoqlQuery`, `listContacts`, `getContact`,
  `parameterizedSearch`, `soslSearch`, `updateContact`, `updateRecord`.
  Webhook config `cwc_1a83eb04e342` exposes `contact.created`, `contact.updated`,
  `contact.deleted`.
- Direction chosen: **Salesforce is source (it can raise events) -> Zoho CRM is target.**
  Zoho has no atomic upsert, so the target side must search-then-branch.

### Prompt B — Build the minimum sync (Salesforce -> Zoho CRM)
Build a workflow that syncs a Salesforce Contact into Zoho CRM.
Source: Salesforce. Target: Zoho CRM. Use the direct connector actions, not the unified API.
Map only: first name, last name, email, phone.
- Input is a Salesforce contact (from the event or fetched with `getContact` if the
  event only carries the Id). If the event payload is missing fields, fetch the full
  contact first and say which fields arrive in the event vs are fetched.
- Normalize email: trim and lowercase.
- Search Zoho CRM for an existing contact by that email (`searchRecords`, module
  `Contacts`). Zoho has no upsert, so:
  - 0 matches -> `createContact`.
  - 1 match -> `updateContact` by the returned Zoho id.
  - >1 matches -> write nothing, return status `ambiguous` with the count.
- Never send a blank value over a non-blank destination value; never touch unrelated fields.
- If email or last name is empty, return a structured `skipped` result with a reason;
  do not create the record. (Zoho requires Last_Name.)
- Return a structured result on every path:
  `{ status: created|updated|skipped|ambiguous|failed, reason, salesforceId,
  zohoId, timestamp }`.
- Set the execution tier to Standard.
- Before finishing: show which connector actions you bound, list unresolved assumptions
  and manual steps, and do not claim it works until a live execution proves it.

### Prompt C — Harden
Add a durable mapping keyed by the Salesforce contact Id (and store the Zoho id) so
updates target the right record and echo loops are avoided. Explain exactly what your
duplicate guard can and cannot guarantee if two runs happen at once. Tell me whether
this trigger type gets a platform deduplication key. For transient failures rely on the
workflow Retry policy (do not hand-roll a loop) and confirm the settings. Never log
tokens, secrets, or full contact payloads.

## Step 5 — Trigger (Salesforce is the source)
1. Create an **App event** trigger: connector Salesforce, connection = our active
   Salesforce, event `contact.created` (add `contact.updated` if time allows).
   Route it to this workflow.
2. Check the **Subscription** column, not just Status. `Active + Subscription: Failed`
   means it will never fire; use **Retry Subscription**.
3. If the event never fires (the Salesforce org may need the Apex trigger/callout
   installed), fall back to a **Schedule** trigger every 5 minutes polling Salesforce
   contacts modified since the last run (`executeSoqlQuery`). Same workflow, only the
   trigger changes. Say "polling" honestly in the demo.

## Step 6 — Tests, evidence, widget

PROVEN so far: create sync (Salesforce -> Zoho) and update sync, both via App event
triggers on `contact.created` and `contact.updated`, both `Subscription: Subscribed`.
Workflow `wf_467e184300df`; proof runs incl. `exec_d9e06db9a6ff`.

### Evidence screenshots (need >= 3; capture all you can)
1. Salesforce source contact
2. Fastn workflow: Diagram tab + Connectors tab (bound actions)
3. Fastn Triggers -> App events: both rows, `Subscription: Subscribed`
4. Activity -> Executions: a Completed run + its Output
5. Zoho CRM destination contact
6. Zoho contact list showing ONE record (no duplicate) after re-sync

### Widget / status indicator (Track 01 requires it)

Requirements gap (Track 01, verbatim):
- [x] Two CRMs connected; record copied one way + updated
- [ ] "any change made in one CRM shows up in the other" -> add REVERSE direction
- [ ] "Connect your CRMs" page the customer uses (click Connect, log in) -> WIDGET
- [ ] Simple status indicator (connected + syncing) -> WIDGET Insights + Connected dots

### Two-way sync (reverse direction: Zoho CRM -> Salesforce)
Zoho CRM cannot raise events (no webhook config), so this direction uses a **Schedule**
trigger every 5 min, polling Zoho contacts modified since the last run.
Destination Salesforce uses `upsertRecord` with `externalIdField: "Email"` -> one atomic
action, auto-dedupes. Loop risk: both directions match on email, so re-syncs converge to
the same record; add a guard that skips when the mapped values are already equal.
Build this as a second workflow with the Platform Agent (same session is fine).

### Widget setup (the customer-facing surface)
`Widgets` in the top nav opens the builder (no list page).
1. **INTEGRATIONS panel -> + Add** -> add the Salesforce + Zoho connectors and the sync
   workflow(s). A two-system integration shows both logos + a direction marker.
2. **Scope**: choose **User level** (each customer connects their own accounts). The
   default **Org level** shares one connection across the org, which is NOT what
   Track 01 asks for.
3. **Pencil (Edit Integration)**: NAME = `Connect your CRMs`; Customer visibility =
   **Specific customers -> CRM Bridge Demo**; Widget enabled = on; Workflows/Triggers
   bind on **Save & publish**.
4. **Layout tab**: Header Title `Integrations`, Subtitle `Connect your CRMs and we keep
   them in sync`. Widget Sections ON: **Apps** (Connect + status dots), **Workflows**
   (visualizer), **Insights** (the status indicator). Search Bar optional.
5. **Save & publish** (sticky footer).
6. **Embed tab**: pick the demo USER, then either a **Shareable link** (persistent, no
   token, easiest to demo) or the **Iframe** snippet for a real embed. Screenshot the
   Apps tab (Connect buttons + Connected dots) and the Insights tab.

Prereq: a demo customer must exist (Settings -> Customers). Scope the widget to it.

## Step 6.5 — Record the 2-minute video
0:00-0:15 Salesforce contact exists
0:15-0:30 show Zoho does NOT yet have it
0:30-0:45 create a new contact in Salesforce
0:45-1:10 Fastn Executions: run Completed
1:10-1:35 show the contact now in Zoho (created)
1:35-1:55 edit phone in Salesforce -> Zoho updates in place, count still 1
1:55-2:00 "no duplicates, no manual copying"
Upload to Google Drive, share "anyone with the link", test in a private window.

## Step 7 — Submit
Submission form: workflow link, video link, >=3 screenshots, short doc + README,
team name/members/track. Every member must also file the feedback form.
**Deadline: agenda says build closes 3:30 PM; PDF says 4:30 PM. Submit before 3:30 PM.**

## Step 8 — Connect opencode to Fastn over MCP (the 20-pt criterion)

Do this **last**, after the core sync passes. Restarting opencode to load the MCP block
ends the current chat session, so save everything to disk first (this file does that).

Config already correct in `D:\Hackathon\opencode.json`:
endpoint `https://mcp.fastn.dev`, `oauth: false`, header `Authorization: Bearer {env:FASTN_API_KEY}`.
Confirmed against Fastn docs (Fastn -> Connect to Claude; gateway = mcp.fastn.dev).

1. Fastn -> **Settings -> MCP server**. It shows the exact MCP URL for this workspace.
   Compare it with `mcp.fastn.dev`. Also open **Connect to Claude** on Home for the URL.
2. Fastn -> **Settings -> API keys -> Create**.
   Name `opencode-mcp` (shows in the audit log). Mode `Test`. Permission `Viewer`.
   Customers it can reach: only `CRM Bridge Demo`. Expiry 30 days. Do NOT tick
   decrypt on Connections or read on Secrets.
3. In a NEW terminal (never paste the key into chat or a file):
   `setx FASTN_API_KEY "fsk_live_your_key_here"`
   Then close that terminal.
4. Quit opencode and reopen it (config loads once).
5. Ask opencode: "list the Fastn MCP tools available". Expect Fastn tools scoped to the
   demo customer, plus dynamic `zoho_*` / `salesforce_*` tools.
6. If empty: try `https://mcp.fastn.dev/mcp`; check `Last used` moved on the key row;
   run `opencode mcp list`. If connected but useless, raise preset to Operator or add
   read on Connectors/Connections/Executions/Events.
7. Constrain scope: each connector detail page -> middle action pane -> **Select all**
   to deselect write actions, so the MCP client can only read.

Evidence to capture: key row (masked), opencode tool list, one real tool call, that call
in Activity -> Executions (Triggered by), and in Settings -> Audit log under `opencode-mcp`.

## Deadlines
Agenda Day 2: build ends **3:30 PM** (submissions lock). PDF says 4:30 PM.
**Submit before 3:30 PM to be safe.** Feedback form is mandatory for every member.

## Security
Never paste API keys, OAuth secrets, or `fsk_live_...` into chat, files, or the video.
