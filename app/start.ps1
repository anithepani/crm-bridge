# Orbit CRM - local start script
# Runs the API handlers from /api against the UI in app/public.
#
# The Fastn API key is read from your user environment (never committed):
#   setx FASTN_API_KEY "fsk_live_..."     # then open a new terminal
# Optional overrides for this shell only:
#   $env:FASTN_API_KEY = "..."

$env:FASTN_HOST = "https://api.fastn.dev"
$env:FASTN_APP_URL = "https://app.fastn.dev"

# Fastn customer (end-org) UUID the widget is scoped to. Per-visitor isolation
# comes from the token, not from a shareable link, so no share URL is stored.
$env:FASTN_END_ORG_ID = "ac8316f8-4f08-4206-8884-27c63cf451af"

if (-not $env:FASTN_API_KEY) {
  $env:FASTN_API_KEY = [Environment]::GetEnvironmentVariable("FASTN_API_KEY", "User")
}
if (-not $env:FASTN_API_KEY) {
  Write-Warning "FASTN_API_KEY is not set - the hub can load but no per-visitor token can be minted."
}

Write-Host "Starting Orbit CRM at http://localhost:3000 ..."
node "$PSScriptRoot\server.js"
