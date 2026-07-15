#!/usr/bin/env bash
# =============================================================
# scripts/check-schema.sh
# Validates the schema boundary, RLS posture, and function
# access matrix after any migration or deploy.
# Use in CD pipelines after `supabase db push` to gate deploy.
#
# Usage:
#   ./scripts/check-schema.sh [--project-ref <ref>] [--local]
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed (deploy should be aborted)
# =============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

PASS=0; FAIL=0; WARN=0
LOCAL=false
PROJECT_REF=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --local)       LOCAL=true;         shift   ;;
    --project-ref) PROJECT_REF="$2";   shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

pass()  { echo -e "  ${GREEN}✓${NC} $*"; ((PASS++));  }
fail()  { echo -e "  ${RED}✗${NC} $*"; ((FAIL++));  }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; ((WARN++));  }
head()  { echo -e "\n${CYAN}── $* ──${NC}"; }

# ── Query helper ─────────────────────────────────────────────
run_sql() {
  local sql="$1"
  if $LOCAL; then
    supabase db execute --local "$sql" 2>/dev/null
  else
    [[ -z "$PROJECT_REF" ]] && { echo "Need --project-ref or --local"; exit 1; }
    supabase db execute --project-ref "$PROJECT_REF" "$sql" 2>/dev/null
  fi
}

run_sql_count() {
  run_sql "SELECT COUNT(*)::TEXT FROM ($1) sub;" | grep -E '^[0-9]+$' | tr -d ' '
}

echo ""
echo -e "${CYAN}Critterverse Schema Integrity Check${NC}"
echo -e "${CYAN}════════════════════════════════════${NC}"


# ═══════════════════════════════════════════════════════════
head "Schema existence"
# ═══════════════════════════════════════════════════════════

for schema in critterverse patchwork_bridge; do
  count=$(run_sql_count "SELECT 1 FROM information_schema.schemata WHERE schema_name = '${schema}'")
  if [[ "$count" -ge "1" ]]; then
    pass "Schema '${schema}' exists"
  else
    fail "Schema '${schema}' MISSING"
  fi
done


# ═══════════════════════════════════════════════════════════
head "critterverse tables (expected 15)"
# ═══════════════════════════════════════════════════════════

EXPECTED_TABLES=(
  "users"
  "trust_events"
  "bounties"
  "submissions"
  "pipeline_events"
  "anomalous_archive_queue"
  "pedometer_bounds"
  "sunshade_trust_edges"
  "council_sessions"
  "council_voter_selection"
  "council_votes"
  "cross_app_identity_links"
  "cross_app_unlocks"
  "critter_species"
  "user_critters"
)

TABLE_FAIL=0
for tbl in "${EXPECTED_TABLES[@]}"; do
  count=$(run_sql_count "SELECT 1 FROM pg_tables WHERE schemaname='critterverse' AND tablename='${tbl}'")
  if [[ "$count" -ge "1" ]]; then
    pass "critterverse.${tbl}"
  else
    fail "critterverse.${tbl} MISSING"
    TABLE_FAIL=1
  fi
done

total_cv=$(run_sql_count "SELECT 1 FROM pg_tables WHERE schemaname='critterverse'")
[[ "$total_cv" -eq "${#EXPECTED_TABLES[@]}" ]] || \
  warn "Unexpected table count: expected ${#EXPECTED_TABLES[@]}, found ${total_cv}"


# ═══════════════════════════════════════════════════════════
head "patchwork_bridge tables (expected 2)"
# ═══════════════════════════════════════════════════════════

for tbl in "webhook_ingestion" "outbound_pings"; do
  count=$(run_sql_count "SELECT 1 FROM pg_tables WHERE schemaname='patchwork_bridge' AND tablename='${tbl}'")
  if [[ "$count" -ge "1" ]]; then
    pass "patchwork_bridge.${tbl}"
  else
    fail "patchwork_bridge.${tbl} MISSING"
  fi
done


# ═══════════════════════════════════════════════════════════
head "RLS enabled on all critterverse tables"
# ═══════════════════════════════════════════════════════════

no_rls=$(run_sql_count \
  "SELECT 1 FROM pg_tables WHERE schemaname='critterverse' AND rowsecurity=FALSE")

if [[ "$no_rls" -eq "0" ]]; then
  pass "All critterverse tables have RLS enabled"
else
  fail "${no_rls} critterverse table(s) WITHOUT RLS — run 009_rls.sql"
fi


# ═══════════════════════════════════════════════════════════
head "patchwork_bridge schema isolation"
# ═══════════════════════════════════════════════════════════

bridge_grants=$(run_sql_count \
  "SELECT 1 FROM information_schema.table_privileges
   WHERE table_schema='patchwork_bridge'
     AND grantee IN ('authenticated','anon')
     AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')")

if [[ "$bridge_grants" -eq "0" ]]; then
  pass "patchwork_bridge: zero DML grants to authenticated/anon"
else
  fail "patchwork_bridge: ${bridge_grants} unexpected DML grant(s) to authenticated/anon — CRITICAL"
fi

# Verify patchwork_bridge is NOT in PostgREST exposed schemas
# (Can't check dashboard setting programmatically; only warn)
warn "Verify manually: Supabase Dashboard → API → Exposed Schemas = 'critterverse' only"


# ═══════════════════════════════════════════════════════════
head "Function EXECUTE access (authenticated role)"
# ═══════════════════════════════════════════════════════════

fn_count=$(run_sql_count \
  "SELECT 1 FROM information_schema.routine_privileges
   WHERE grantee='authenticated' AND routine_schema='critterverse'")

if [[ "$fn_count" -le "9" ]]; then
  pass "authenticated EXECUTE grants: ${fn_count} (≤ 9 whitelisted functions)"
else
  fail "authenticated EXECUTE grants: ${fn_count} — expected ≤ 9. Run 013_function_security.sql"
fi

# Verify the 9 safe functions are present
SAFE_FUNCTIONS=(
  "haversine_km"
  "sha256_hex"
  "bounty_staleness_score"
  "compute_pedometer_bounds"
  "compute_pedometer_bounds_from_coords"
  "get_bounty_indicators"
  "get_gopher_task"
  "select_council_voters"
  "verify_trust_chain"
)

missing_safe=0
for fn in "${SAFE_FUNCTIONS[@]}"; do
  count=$(run_sql_count \
    "SELECT 1 FROM information_schema.routine_privileges
     WHERE grantee='authenticated'
       AND routine_schema='critterverse'
       AND routine_name='${fn}'")
  [[ "$count" -eq "0" ]] && { warn "Safe function not granted to authenticated: ${fn}"; ((missing_safe++)); }
done
[[ "$missing_safe" -eq "0" ]] && pass "All 9 whitelisted functions grantable to authenticated"


# ═══════════════════════════════════════════════════════════
head "Privileged functions NOT executable by authenticated"
# ═══════════════════════════════════════════════════════════

PRIVILEGED=(
  "apply_trust_slash"
  "apply_trust_bonus"
  "credit_reputation"
  "resolve_council_session"
  "attempt_critter_drop"
)

priv_fail=0
for fn in "${PRIVILEGED[@]}"; do
  count=$(run_sql_count \
    "SELECT 1 FROM information_schema.routine_privileges
     WHERE grantee='authenticated'
       AND routine_schema='critterverse'
       AND routine_name='${fn}'")
  if [[ "$count" -eq "0" ]]; then
    pass "critterverse.${fn}: NOT executable by authenticated ✓"
  else
    fail "critterverse.${fn}: INCORRECTLY executable by authenticated — CRITICAL"
    ((priv_fail++))
  fi
done


# ═══════════════════════════════════════════════════════════
head "Append-only rules on trust_events"
# ═══════════════════════════════════════════════════════════

for rule in "trust_events_no_update" "trust_events_no_delete"; do
  count=$(run_sql_count \
    "SELECT 1 FROM pg_rules
     WHERE schemaname='critterverse'
       AND tablename='trust_events'
       AND rulename='${rule}'")
  if [[ "$count" -ge "1" ]]; then
    pass "Rule ${rule} exists"
  else
    fail "Rule ${rule} MISSING — trust chain is mutable"
  fi
done


# ═══════════════════════════════════════════════════════════
head "Append-only rules on patchwork_bridge.webhook_ingestion"
# ═══════════════════════════════════════════════════════════

for rule in "bridge_webhook_no_update" "bridge_webhook_no_delete"; do
  count=$(run_sql_count \
    "SELECT 1 FROM pg_rules
     WHERE schemaname='patchwork_bridge'
       AND tablename='webhook_ingestion'
       AND rulename='${rule}'")
  if [[ "$count" -ge "1" ]]; then
    pass "Rule ${rule} exists"
  else
    fail "Rule ${rule} MISSING"
  fi
done


# ═══════════════════════════════════════════════════════════
head "Key indexes"
# ═══════════════════════════════════════════════════════════

CRITICAL_INDEXES=(
  "critterverse|idx_ste_covering"
  "critterverse|idx_bounties_gopher_eligible"
  "critterverse|idx_council_deadline_scan"
  "critterverse|idx_cvs_voter_recent"
  "critterverse|idx_submissions_user_recent"
  "critterverse|idx_anomalous_pending_age"
  "critterverse|idx_users_sunshade_path"
  "patchwork_bridge|idx_pings_pending"
)

for entry in "${CRITICAL_INDEXES[@]}"; do
  schema="${entry%%|*}"
  idx="${entry##*|}"
  count=$(run_sql_count \
    "SELECT 1 FROM pg_indexes WHERE schemaname='${schema}' AND indexname='${idx}'")
  if [[ "$count" -ge "1" ]]; then
    pass "${schema}.${idx}"
  else
    warn "${schema}.${idx} MISSING — run 015_performance_indexes.sql"
  fi
done


# ═══════════════════════════════════════════════════════════
head "CRON jobs (4 expected)"
# ═══════════════════════════════════════════════════════════

CRON_JOBS=(
  "critterverse-council-resolve"
  "critterverse-bridge-retry-pings"
  "critterverse-sunshade-mirror"
  "critterverse-bounty-maintenance"
)

for job in "${CRON_JOBS[@]}"; do
  count=$(run_sql_count \
    "SELECT 1 FROM cron.job WHERE jobname='${job}'" 2>/dev/null || echo "0")
  if [[ "$count" -ge "1" ]]; then
    pass "CRON job: ${job}"
  else
    warn "CRON job missing: ${job} — run 012_cron_setup.sql"
  fi
done


# ═══════════════════════════════════════════════════════════
head "Seed data"
# ═══════════════════════════════════════════════════════════

bounty_count=$(run_sql_count \
  "SELECT 1 FROM critterverse.bounties WHERE source='admin_seeded'")
species_count=$(run_sql_count \
  "SELECT 1 FROM critterverse.critter_species")

if [[ "$bounty_count" -ge "15" ]]; then
  pass "Alpha bounties: ${bounty_count} (≥ 15)"
else
  warn "Alpha bounties: ${bounty_count} (expected ≥ 15 — run 010_seed_alpha.sql)"
fi

if [[ "$species_count" -ge "12" ]]; then
  pass "Critter species: ${species_count} (≥ 12)"
else
  warn "Critter species: ${species_count} (expected ≥ 12 — run 010_seed_alpha.sql)"
fi


# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}   ${PASS}"
echo -e "  ${YELLOW}Warnings:${NC} ${WARN}"
echo -e "  ${RED}Failed:${NC}   ${FAIL}"
echo -e "${CYAN}════════════════════════════════════${NC}"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Schema check FAILED. Do not proceed with deploy.${NC}"
  exit 1
elif [[ "$WARN" -gt 0 ]]; then
  echo -e "${YELLOW}Schema check passed with warnings. Review before production deploy.${NC}"
  exit 0
else
  echo -e "${GREEN}Schema check PASSED. Safe to deploy.${NC}"
  exit 0
fi
