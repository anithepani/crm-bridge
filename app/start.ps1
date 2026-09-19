# Orbit CRM - start script
# Serves the demo SaaS app with the Fastn "Connect your CRMs" widget embedded.

$env:FASTN_HOST = "https://api.fastn.dev"
$env:FASTN_APP_URL = "https://app.fastn.dev"
$env:FASTN_CUSTOMER = "crm-bridge-demo"
$env:FASTN_CUSTOMER_ID = "ac8316f8-4f08-4206-8884-27c63cf451af"

# Fastn shareable widget link for the demo customer (persistent, no token needed).
$env:WIDGET_URL = "https://api.fastn.dev/api/v1/embed/iframe?share=embshare_UjrRrlnXJ5U8F5uvgfyigPPxsoojcGMCfoK7OTY1HYI"

# Fastn API key: used server-side only (never sent to the browser) to read live
# connection status for the connector cards. Read from your user environment so
# it never lands in this repo. Override per-shell with $env:FASTN_API_KEY = "..." if needed.
if (-not $env:FASTN_API_KEY) {
  $env:FASTN_API_KEY = [Environment]::GetEnvironmentVariable("FASTN_API_KEY", "User")
}
if (-not $env:FASTN_API_KEY) {
  Write-Warning "FASTN_API_KEY is not set - the integration hub still works, but connector status cards stay unresolved."
}

Write-Host "Starting Orbit CRM at http://localhost:3000 ..."
node "$PSScriptRoot\server.js"
