# CRM Bridge — Submission

**Hackathon:** Build with Fastn · **Track 01: CRM Sync Between Two CRMs**
**Team:** Aryan, Hanzila

## What we built

A customer-facing integration that keeps contacts in sync between **Salesforce** and
**Zoho CRM**, in both directions, from an embedded Fastn widget. The customer connects
both CRMs once and every change flows across automatically — no exports, no manual
copying, no duplicates.

## Problem it solves

Businesses that run two CRMs lose time and trust because records drift: an update in one
system never reaches the other. The usual workarounds — CSV exports or a one-off internal
script — are manual and break silently. CRM Bridge gives the customer a self-serve
"Connect your CRMs" page, then keeps both systems accurate on its own and shows them the
sync status.

## How it works

- **Salesforce -> Zoho CRM — real time.** A Salesforce app event
  (`contact.created` / `contact.updated`) drives a workflow that normalizes the email,
  finds the Zoho contact by email, and creates or updates it. Changes appear in seconds.
- **Zoho CRM -> Salesforce — every 5 minutes.** Zoho CRM cannot emit webhooks, so a
  scheduled workflow polls contacts modified since the last run and writes them to
  Salesforce with an atomic upsert by email.

Both workflows were built and debugged with Fastn's **Platform Agent**.

## Why it is safe to leave running

- **No duplicates:** search-then-branch on one side, atomic upsert-by-Email on the other.
- **No data loss:** a blank source value never overwrites a populated destination value.
- **No infinite loops:** both workflows skip the write when the destination already holds
  the same values, so neither side keeps re-triggering the other. Proven live.
- **Explainable:** every run returns a structured status with a reason
  (`created` / `updated` / `skipped` / `ambiguous` / `failed`).

## Customer experience

Inside the widget (scoped to the customer) they see `Connect your CRMs` with Salesforce
and Zoho CRM. They click **Connect**, sign in once, and approve. The cards show a green
**Connected** status and the **Insights** tab reports sync activity — so the customer can
see that their accounts are connected and syncing.

## Evidence

- **Workflows:** `sync-salesforce-contact-to-zoho` (`wf_467e184300df`, v3) and
  `sync-zoho-contact-to-salesforce` (`wf_d8e91b3cccdb`, v1).
- **Triggers:** two App-event triggers (Salesforce, `Subscription: Subscribed`) and one
  Schedule trigger (`*/5 * * * *`).
- **Live executions** proving create, update, and echo-prevention skip in both
  directions (see `README.md` for the test matrix and screenshots list).

## Known limitation (stated honestly)

The Zoho CRM -> Salesforce direction runs on a **5-minute schedule**, not instantly,
because the Zoho CRM connector does not support outbound events. Everything else is
real time.
