#!/usr/bin/env bash
# =============================================================
# scripts/local-dev.sh
# One-command local dev environment setup.
# Starts Supabase, applies migrations, seeds test data,
# starts the Edge Functions server, and prints connection info.
#
# Usage: ./scripts/local-dev.sh [--reset]
#   --reset  Tears down and recreates the local DB before setup
# =============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${GREEN}[local-dev]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}     $*"; }
step()    { echo -e "${CYAN}[step]${NC}     $*"; }
error()   { echo -e "${RED}[error]${NC}    $*" >&2; exit 1; }
divider() { echo -e "${CYAN}────────────────────────────────────────${NC}"; }

RESET=false
while [[ $# -gt 0 ]]; do
  case $1 in --reset) RESET=true; shift ;; *) error "Unknown arg: $1" ;; esac
done

# ── Check prerequisites ───────────────────────────────────────
step "Checking prerequisites..."

command -v supabase >/dev/null || error "supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
command -v deno     >/dev/null || error "deno not found. Install: https://deno.land"
command -v jq       >/dev/null || error "jq not found. Install: brew install jq"

SUPA_VER=$(supabase --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
DENO_VER=$(deno --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
info "supabase CLI: ${SUPA_VER}  |  deno: ${DENO_VER}"

# ── Reset if requested ────────────────────────────────────────
if $RESET; then
  warn "--reset: stopping and removing existing local Supabase data..."
  supabase stop --no-backup 2>/dev/null || true
fi

# ── Start Supabase ────────────────────────────────────────────
step "Starting local Supabase..."

if supabase status 2>/dev/null | grep -q "supabase local development setup is running"; then
  info "Supabase already running — skipping start."
else
  supabase start
fi

# ── Extract credentials ───────────────────────────────────────
STATUS=$(supabase status --output json 2>/dev/null)

LOCAL_URL=$(echo "$STATUS"     | jq -r '.api_url         // "http://localhost:54321"')
ANON_KEY=$(echo "$STATUS"      | jq -r '.anon_key        // ""')
SERVICE_KEY=$(echo "$STATUS"   | jq -r '.service_role_key // ""')
JWT_SECRET=$(echo "$STATUS"    | jq -r '.jwt_secret      // "super-secret-jwt-token-with-at-least-32-characters-long"')
STUDIO_URL=$(echo "$STATUS"    | jq -r '.studio_url      // "http://localhost:54323"')

[[ -z "$ANON_KEY" ]]    && error "Could not extract anon_key from supabase status"
[[ -z "$SERVICE_KEY" ]] && error "Could not extract service_role_key from supabase status"

# ── Apply migrations ──────────────────────────────────────────
step "Applying migrations (001 → 014)..."
supabase db push
info "Migrations applied."

# ── Configure pg_cron database settings ──────────────────────
step "Setting pg_cron database settings..."
GENESIS_HASH="a3f8c2d1e9b047561a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4"
INTERNAL_KEY="local-internal-key-32chars-padding"

supabase db execute --local "ALTER DATABASE postgres SET app.supabase_url = '${LOCAL_URL}';" 2>/dev/null || \
  warn "Could not set app.supabase_url — CRON functions will use env var fallback"
supabase db execute --local "ALTER DATABASE postgres SET app.internal_key = '${INTERNAL_KEY}';" 2>/dev/null || \
  warn "Could not set app.internal_key — CRON functions will use env var fallback"

# ── Set local secrets ─────────────────────────────────────────
step "Setting local Edge Function secrets..."

supabase secrets set \
  CRITTERVERSE_BOOTSTRAP_SECRET="local-bootstrap-secret-32chars-p" \
  TRUST_CHAIN_GENESIS_HASH="${GENESIS_HASH}" \
  INTERNAL_FUNCTION_KEY="${INTERNAL_KEY}" \
  ZKP_PIPELINE_ENDPOINT="http://localhost:9999/mock/zkp" \
  ZKP_PIPELINE_API_KEY="mock-zkp-key" \
  VISION_MODEL_ENDPOINT="http://localhost:9999/mock/vision" \
  VISION_MODEL_API_KEY="mock-vision-key" \
  PHASH_SERVICE_ENDPOINT="http://localhost:9999/mock/phash" \
  PATCHWORK_WEBHOOK_SECRET="local-patchwork-secret-32chars-p" \
  PATCHWORK_AUDIT_WEBHOOK_URL="http://localhost:9999/mock/pw-audit" \
  CRITTERVERSE_OUTBOUND_SECRET="local-outbound-secret-32chars-pp" \
  PATCHWORK_PUBLIC_API="http://localhost:9999/mock/pw-api" \
  SUNSHADE_GRAPH_API="http://localhost:9999/mock/sunshade" \
  SUNSHADE_API_KEY="mock-sunshade-key"

info "Secrets set."

# ── Write .env.local for test suite ───────────────────────────
step "Writing .env.local for test suite..."

cat > .env.local <<EOF
SUPABASE_URL=${LOCAL_URL}
SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
SUPABASE_JWT_SECRET=${JWT_SECRET}
TRUST_CHAIN_GENESIS_HASH=${GENESIS_HASH}
INTERNAL_FUNCTION_KEY=${INTERNAL_KEY}
PATCHWORK_WEBHOOK_SECRET=local-patchwork-secret-32chars-p
EOF

info ".env.local written. Source it before running tests: source .env.local"

# ── Start Edge Functions server ───────────────────────────────
step "Starting Edge Functions server (background)..."

# Kill any existing functions server
pkill -f "supabase functions serve" 2>/dev/null || true
sleep 1

supabase functions serve \
  --import-map import_map.json \
  --no-verify-jwt \
  > /tmp/critterverse-functions.log 2>&1 &

FUNCTIONS_PID=$!
echo $FUNCTIONS_PID > /tmp/critterverse-functions.pid
sleep 3

if kill -0 "$FUNCTIONS_PID" 2>/dev/null; then
  info "Edge Functions server running (PID ${FUNCTIONS_PID})"
  info "Logs: tail -f /tmp/critterverse-functions.log"
else
  warn "Edge Functions server may not have started. Check /tmp/critterverse-functions.log"
fi

# ── Quick smoke test ──────────────────────────────────────────
step "Running quick smoke test..."

sleep 2
HEALTH=$(curl -sf \
  -H "X-Internal-Key: ${INTERNAL_KEY}" \
  "${LOCAL_URL}/functions/v1/admin/health-check" 2>/dev/null | jq -r '.overall' 2>/dev/null || echo "unreachable")

if [[ "$HEALTH" == "ok" ]]; then
  info "Health check: ${GREEN}ok${NC}"
elif [[ "$HEALTH" == "warn" ]]; then
  warn "Health check: warn (some subsystems have issues — check SunShade mirror and bridge)"
elif [[ "$HEALTH" == "unreachable" ]]; then
  warn "Health check: functions server not yet ready. Try again in a few seconds:"
  warn "  curl -H 'X-Internal-Key: ${INTERNAL_KEY}' ${LOCAL_URL}/functions/v1/admin/health-check"
else
  warn "Health check returned: ${HEALTH}"
fi

# ── Print summary ─────────────────────────────────────────────
divider
echo ""
info "Local Critterverse environment ready."
echo ""
echo "  Supabase Studio:    ${STUDIO_URL}"
echo "  API URL:            ${LOCAL_URL}"
echo "  Functions base URL: ${LOCAL_URL}/functions/v1/"
echo ""
echo "  Key endpoints:"
echo "    ── Mobile / Authenticated ──────────────────────────────────────"
echo "    POST ${LOCAL_URL}/functions/v1/pipeline/initiate"
echo "    POST ${LOCAL_URL}/functions/v1/pipeline/offline-sync"
echo "    GET  ${LOCAL_URL}/functions/v1/public/submission-status?submission_id=<uuid>"
echo "    GET  ${LOCAL_URL}/functions/v1/user/profile"
echo "    POST ${LOCAL_URL}/functions/v1/council/accept         { session_id, action }"
echo "    POST ${LOCAL_URL}/functions/v1/council/vote           { session_id, commitment_hash, stake }"
echo "    POST ${LOCAL_URL}/functions/v1/council/reveal         { session_id, vote, salt }"
echo "    GET  ${LOCAL_URL}/functions/v1/council/voter-status"
echo "    GET  ${LOCAL_URL}/functions/v1/trust/quarantine"
echo "    POST ${LOCAL_URL}/functions/v1/trust/redemption-t2    { action, user_lat, user_lng }"
echo "    POST ${LOCAL_URL}/functions/v1/identity/cross-app-link"
echo ""
echo "    ── Public (no auth) ────────────────────────────────────────────"
echo "    GET  ${LOCAL_URL}/functions/v1/public/bounty-indicators?lat=37.77&lng=-122.41"
echo ""
echo "    ── Admin (X-Internal-Key: ${INTERNAL_KEY}) ──────────"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/health-check"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/pipeline-audit?submission_id=<uuid>"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/user-report?user_id=<uuid>"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/analytics"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/analytics?view=daily_submission_stats"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/analytics?view=trust_distribution"
echo "    GET  ${LOCAL_URL}/functions/v1/admin/analytics?view=anomalous_queue_status"
echo ""
echo "    ── Internal (bootstrap) ────────────────────────────────────────"
echo "    POST ${LOCAL_URL}/functions/v1/identity/bootstrap  (Bearer \${CRITTERVERSE_BOOTSTRAP_SECRET})"
echo ""
echo "  Run tests:"
echo "    source .env.local && deno task test"
echo "    source .env.local && deno task test:rls"
echo "    source .env.local && deno task test:pipeline"
echo ""
echo "  Stop functions server:"
echo "    kill \$(cat /tmp/critterverse-functions.pid)"
echo ""
echo "  Stop Supabase:"
echo "    supabase stop"
echo ""
divider
