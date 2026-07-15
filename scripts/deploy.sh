#!/usr/bin/env bash
# =============================================================
# scripts/deploy.sh
# Full Critterverse deploy: migrations → functions → CRON → smoke
#
# Usage:
#   ./scripts/deploy.sh [--project-ref <ref>] [--env staging|production]
#
# Prerequisites:
#   supabase CLI >= 1.142.0
#   Deno >= 1.40.0
#   All required secrets already set via `supabase secrets set`
# =============================================================

set -euo pipefail

# ── Colour output ─────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── Parse args ────────────────────────────────────────────────
PROJECT_REF=""
ENV="staging"

while [[ $# -gt 0 ]]; do
  case $1 in
    --project-ref) PROJECT_REF="$2"; shift 2 ;;
    --env)         ENV="$2";         shift 2 ;;
    *) error "Unknown argument: $1" ;;
  esac
done

[[ -z "$PROJECT_REF" ]] && error "--project-ref is required"
[[ "$ENV" != "staging" && "$ENV" != "production" ]] && error "--env must be staging or production"

info "Deploying Critterverse to ${ENV} (project: ${PROJECT_REF})"

# ── Production gate ───────────────────────────────────────────
if [[ "$ENV" == "production" ]]; then
  warn "You are deploying to PRODUCTION."
  read -r -p "Type 'deploy production' to confirm: " CONFIRM
  [[ "$CONFIRM" != "deploy production" ]] && error "Aborted."
fi

# ── Step 0: Link project ──────────────────────────────────────
info "Step 0: Linking Supabase project..."
supabase link --project-ref "$PROJECT_REF"

# ── Step 1: Pre-flight checks ─────────────────────────────────
info "Step 1: Pre-flight checks..."

# Verify required secrets exist
REQUIRED_SECRETS=(
  "CRITTERVERSE_BOOTSTRAP_SECRET"
  "TRUST_CHAIN_GENESIS_HASH"
  "INTERNAL_FUNCTION_KEY"
  "ZKP_PIPELINE_ENDPOINT"
  "ZKP_PIPELINE_API_KEY"
  "VISION_MODEL_ENDPOINT"
  "VISION_MODEL_API_KEY"
  "PHASH_SERVICE_ENDPOINT"
  "PATCHWORK_WEBHOOK_SECRET"
  "PATCHWORK_AUDIT_WEBHOOK_URL"
  "CRITTERVERSE_OUTBOUND_SECRET"
  "PATCHWORK_PUBLIC_API"
  "SUNSHADE_GRAPH_API"
  "SUNSHADE_API_KEY"
)

SECRETS_OUTPUT=$(supabase secrets list 2>/dev/null || echo "")
MISSING_SECRETS=()

for SECRET in "${REQUIRED_SECRETS[@]}"; do
  if ! echo "$SECRETS_OUTPUT" | grep -q "^${SECRET}"; then
    MISSING_SECRETS+=("$SECRET")
  fi
done

if [[ ${#MISSING_SECRETS[@]} -gt 0 ]]; then
  error "Missing required secrets:\n$(printf '  - %s\n' "${MISSING_SECRETS[@]}")\nRun: supabase secrets set <NAME>=<VALUE>"
fi

info "All required secrets present."

# ── Step 2: Run migrations ────────────────────────────────────
info "Step 2: Running migrations (001 → 016)..."

MIGRATION_FILES=(
  "../sunshade-db-platform/migrations/20260715000000_schema_init.sql"
  "../sunshade-db-platform/migrations/20260715000100_critterverse_core.sql"
  "../sunshade-db-platform/migrations/20260715000200_pipeline.sql"
  "../sunshade-db-platform/migrations/20260715000300_trust_graph.sql"
  "../sunshade-db-platform/migrations/20260715000400_council.sql"
  "../sunshade-db-platform/migrations/20260715000500_bridge.sql"
  "../sunshade-db-platform/migrations/20260715000600_cross_app.sql"
  "../sunshade-db-platform/migrations/20260715000700_functions.sql"
  "../sunshade-db-platform/migrations/20260715000800_rls.sql"
  "../sunshade-db-platform/migrations/20260715000900_seed_alpha.sql"
  "../sunshade-db-platform/migrations/20260715001000_missing_functions.sql"
  "../sunshade-db-platform/migrations/20260715001100_cron_setup.sql"
  "../sunshade-db-platform/migrations/20260715001200_function_security.sql"
  "../sunshade-db-platform/migrations/20260715001300_rls_addendum.sql"
  "../sunshade-db-platform/migrations/20260715001400_performance_indexes.sql"
  "../sunshade-db-platform/migrations/20260715001500_analytics_views.sql"
)

supabase db push

info "Migrations applied."

# ── Step 2b: Schema integrity check ──────────────────────────
info "Step 2b: Validating schema integrity..."

if $LOCAL; then
  bash scripts/check-schema.sh --local || {
    error "Schema check failed after migrations. Aborting deploy."
  }
else
  bash scripts/check-schema.sh --project-ref "$PROJECT_REF" || {
    error "Schema check failed after migrations. Aborting deploy."
  }
fi

# ── Step 3: Verify schema boundary ───────────────────────────
info "Step 3: Verifying schema boundary..."

SCHEMA_CHECK=$(supabase db query \
  "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('critterverse','patchwork_bridge','public') GROUP BY schemaname ORDER BY schemaname;" \
  2>/dev/null || echo "")

echo "$SCHEMA_CHECK"

# Confirm patchwork_bridge is NOT in the PostgREST exposed schemas
# (We can't check the dashboard setting programmatically, so we warn instead)
warn "ACTION REQUIRED: Verify PostgREST exposed schemas in dashboard."
warn "  Expected: critterverse"
warn "  Must NOT include: patchwork_bridge, public (unless needed)"

# ── Step 4: Deploy Edge Functions ────────────────────────────
info "Step 4: Deploying Edge Functions..."

# Public endpoint — no JWT verification
supabase functions deploy public/bounty-indicators --no-verify-jwt
info "  ✓ public/bounty-indicators"

# All other functions require JWT or internal key
FUNCTIONS=(
  "identity/bootstrap"
  "identity/cross-app-link"
  "pipeline/initiate"
  "pipeline/zkp-callback"
  "pipeline/hash-process"
  "pipeline/offline-sync"
  "council/select-voters"
  "council/accept"
  "council/vote"
  "council/reveal"
  "council/resolve"
  "council/voter-status"
  "trust/slash"
  "trust/quarantine"
  "trust/redemption-t1"
  "trust/redemption-t2"
  "bridge/patchwork-inbound"
  "bridge/patchwork-outbound"
  "bridge/retry-pings"
  "public/submission-status"
  "user/profile"
  "sync/sunshade-mirror"
  "sync/bounty-maintenance"
  "admin/health-check"
  "admin/pipeline-audit"
  "admin/user-report"
  "admin/analytics"
)

for FN in "${FUNCTIONS[@]}"; do
  supabase functions deploy "$FN"
  info "  ✓ ${FN}"
done

info "All Edge Functions deployed (${#FUNCTIONS[@]} authenticated + 1 unauthenticated public)."

# ── Step 5: Configure CRON jobs ──────────────────────────────
info "Step 5: Setting up CRON jobs..."

SUPABASE_URL_VALUE=$(supabase status 2>/dev/null | grep "API URL" | awk '{print $3}' || echo "")
INTERNAL_KEY_VALUE=$(supabase secrets list 2>/dev/null | grep "^INTERNAL_FUNCTION_KEY" | awk '{print $2}' || echo "")

if [[ -n "$SUPABASE_URL_VALUE" && -n "$INTERNAL_KEY_VALUE" ]]; then
  supabase db query "ALTER DATABASE postgres SET app.supabase_url = '${SUPABASE_URL_VALUE}';" 2>/dev/null || true
  supabase db query "ALTER DATABASE postgres SET app.internal_key = '${INTERNAL_KEY_VALUE}';" 2>/dev/null || true
  supabase db query "$(cat ../sunshade-db-platform/migrations/20260715001100_cron_setup.sql)" 2>/dev/null || \
    warn "CRON setup via SQL failed — run 20260715001100_cron_setup.sql manually in the SQL editor."
  info "CRON jobs configured."
else
  warn "Could not auto-detect SUPABASE_URL or INTERNAL_FUNCTION_KEY."
  warn "Run ../sunshade-db-platform/migrations/20260715001100_cron_setup.sql manually in the Supabase SQL editor."
fi

# ── Step 6: Disable native GoTrue providers ──────────────────
info "Step 6: Verifying native auth providers are disabled..."
warn "ACTION REQUIRED: Ensure all native GoTrue providers are disabled in:"
warn "  Dashboard → Authentication → Providers"
warn "  (Email, Phone, Google, GitHub, Apple must all be OFF)"
warn "  SunShade is the sole Identity Provider."

# ── Step 7: Smoke test ───────────────────────────────────────
info "Step 7: Smoke test via health-check endpoint..."

HEALTH_URL="${SUPABASE_URL_VALUE}/functions/v1/admin/health-check"
INTERNAL_KEY_FROM_ENV="${INTERNAL_KEY_VALUE}"

if [[ -n "$HEALTH_URL" && -n "$INTERNAL_KEY_FROM_ENV" ]]; then
  HEALTH_RESPONSE=$(curl -s -o /tmp/health_response.json -w "%{http_code}" \
    -H "X-Internal-Key: ${INTERNAL_KEY_FROM_ENV}" \
    "$HEALTH_URL" || echo "000")

  if [[ "$HEALTH_RESPONSE" == "200" ]]; then
    OVERALL=$(python3 -c "import json,sys; d=json.load(open('/tmp/health_response.json')); print(d.get('overall','unknown'))" 2>/dev/null || echo "unknown")
    info "Health check: ${OVERALL}"
    if [[ "$OVERALL" != "ok" ]]; then
      warn "Health check returned '${OVERALL}' — review /tmp/health_response.json for details."
      cat /tmp/health_response.json
    fi
  else
    warn "Health check returned HTTP ${HEALTH_RESPONSE} — function may still be warming up."
  fi
else
  warn "Skipping smoke test — could not resolve health-check URL."
fi

# ── Step 8: Print post-deploy checklist ──────────────────────
echo ""
info "══════════════════════════════════════════════"
info "  Critterverse deploy complete (${ENV})"
info "══════════════════════════════════════════════"
echo ""
echo "  Post-deploy checklist:"
echo "  [ ] PostgREST exposed schemas: critterverse only (not patchwork_bridge)"
echo "  [ ] JWT Secret aligned with SunShade Hub signing key"
echo "  [ ] All native GoTrue providers disabled"
echo "  [ ] Seed data visible: critterverse.bounties (15 alpha bounties)"
echo "  [ ] Health check: /functions/v1/admin/health-check returns 'ok'"
echo "  [ ] PatchWork team notified of webhook endpoint URL:"
echo "      ${SUPABASE_URL_VALUE}/functions/v1/bridge/patchwork-inbound"
echo "  [ ] CRON jobs visible in Supabase Dashboard → Database → Cron Jobs"
echo ""
echo "  Run integration tests against staging:"
echo "    SUPABASE_URL=${SUPABASE_URL_VALUE} \\"
echo "    SUPABASE_SERVICE_ROLE_KEY=<key> \\"
echo "    SUPABASE_ANON_KEY=<anon-key> \\"
echo "    SUPABASE_JWT_SECRET=<jwt-secret> \\"
echo "    deno task test"
echo ""
