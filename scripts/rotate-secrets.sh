#!/usr/bin/env bash
# =============================================================
# scripts/rotate-secrets.sh
# Coordinated secret rotation for Critterverse.
# Run whenever a secret has been (or may have been) compromised,
# or on the regular rotation schedule (see SECURITY.md §7).
#
# Usage:
#   ./scripts/rotate-secrets.sh --secret <name> --project-ref <ref>
#
# Available secrets:
#   INTERNAL_FUNCTION_KEY
#   CRITTERVERSE_BOOTSTRAP_SECRET
#   PATCHWORK_WEBHOOK_SECRET
#   CRITTERVERSE_OUTBOUND_SECRET
#   JWT_SECRET  (requires SunShade Hub coordination — see note below)
# =============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[rotate]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

SECRET_NAME=""
PROJECT_REF=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --secret)      SECRET_NAME="$2"; shift 2 ;;
    --project-ref) PROJECT_REF="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true;     shift   ;;
    *) error "Unknown argument: $1" ;;
  esac
done

[[ -z "$SECRET_NAME" ]]  && error "--secret is required"
[[ -z "$PROJECT_REF" ]]  && error "--project-ref is required"

ALLOWED_SECRETS=(
  "INTERNAL_FUNCTION_KEY"
  "CRITTERVERSE_BOOTSTRAP_SECRET"
  "PATCHWORK_WEBHOOK_SECRET"
  "CRITTERVERSE_OUTBOUND_SECRET"
)

if [[ "$SECRET_NAME" == "JWT_SECRET" ]]; then
  cat <<EOF

  ${RED}JWT_SECRET rotation requires SunShade Hub coordination.${NC}

  This is a breaking change: ALL active user sessions are immediately
  invalidated when the JWT signing key changes.

  Procedure:
  1. Coordinate a maintenance window with the SunShade team.
  2. Generate new key: openssl rand -hex 32
  3. Update SunShade Hub signing config FIRST.
  4. Update Supabase Dashboard → Auth → JWT Settings within 60s.
  5. Alert users that they will be signed out.

  Do NOT use this script for JWT_SECRET rotation.
  There is no automated path for this — it requires human coordination.

EOF
  exit 1
fi

VALID_SECRET=false
for s in "${ALLOWED_SECRETS[@]}"; do [[ "$s" == "$SECRET_NAME" ]] && VALID_SECRET=true; done
[[ "$VALID_SECRET" == "false" ]] && error "Unknown secret: $SECRET_NAME. Run with no --secret to see list."

# ── Generate new secret value ─────────────────────────────────
NEW_VALUE=$(openssl rand -hex 32)
info "Generated new value for ${SECRET_NAME}: ${NEW_VALUE:0:8}...${NEW_VALUE: -4}"

if $DRY_RUN; then
  warn "--dry-run: no changes made."
  info "Would set ${SECRET_NAME}=<new-value> on project ${PROJECT_REF}"
  exit 0
fi

# ── Confirm ───────────────────────────────────────────────────
echo ""
warn "About to rotate ${SECRET_NAME} on project ${PROJECT_REF}."
warn "This will invalidate all current uses of this secret."
read -r -p "Type 'rotate ${SECRET_NAME}' to confirm: " CONFIRM
[[ "$CONFIRM" != "rotate ${SECRET_NAME}" ]] && error "Aborted."

# ── Apply to Supabase ─────────────────────────────────────────
supabase link --project-ref "$PROJECT_REF"
supabase secrets set "${SECRET_NAME}=${NEW_VALUE}"
info "${SECRET_NAME} rotated in Supabase."

# ── Post-rotation actions per secret ─────────────────────────
case "$SECRET_NAME" in
  "PATCHWORK_WEBHOOK_SECRET")
    cat <<EOF

  ${YELLOW}ACTION REQUIRED:${NC}
  Share the new PATCHWORK_WEBHOOK_SECRET with the PatchWork team.
  They must update their webhook signature config before their next
  webhook delivery, otherwise all inbound events will be rejected
  (logged as hmac_verified=false in patchwork_bridge.webhook_ingestion).

  New value: ${NEW_VALUE}
  (Communicate via a secure channel — never email or Slack plaintext)

EOF
    ;;

  "CRITTERVERSE_OUTBOUND_SECRET")
    cat <<EOF

  ${YELLOW}ACTION REQUIRED:${NC}
  Share the new CRITTERVERSE_OUTBOUND_SECRET with the PatchWork team.
  They must update their inbound verification config to accept the
  new signature, otherwise outbound audit pings will be rejected.

  New value: ${NEW_VALUE}

EOF
    ;;

  "CRITTERVERSE_BOOTSTRAP_SECRET")
    cat <<EOF

  ${YELLOW}ACTION REQUIRED:${NC}
  Update the CRITTERVERSE_BOOTSTRAP_SECRET in the SunShade Hub.
  The Hub uses this to authenticate the one-time user bootstrap call.
  Until updated, new user registrations via Critterverse will fail.

  New value: ${NEW_VALUE}

EOF
    ;;

  "INTERNAL_FUNCTION_KEY")
    cat <<EOF

  ${YELLOW}NOTE:${NC}
  INTERNAL_FUNCTION_KEY is used by CRON jobs and internal Edge Function
  calls. The new value will take effect on the next function invocation.
  CRON jobs use the pg_cron app.internal_key database setting.

  You must also update the pg_cron database setting:
    supabase db execute --project-ref ${PROJECT_REF} \\
      "ALTER DATABASE postgres SET app.internal_key = '${NEW_VALUE}';"

EOF
    ;;
esac

# ── Run health check ──────────────────────────────────────────
info "Running post-rotation health check..."
sleep 3

HEALTH_URL=$(supabase status --output json 2>/dev/null | jq -r '.api_url' 2>/dev/null || echo "")
if [[ -n "$HEALTH_URL" ]]; then
  OVERALL=$(curl -sf \
    -H "X-Internal-Key: ${SECRET_NAME == "INTERNAL_FUNCTION_KEY" && echo "$NEW_VALUE" || cat /dev/null}" \
    "${HEALTH_URL}/functions/v1/admin/health-check" 2>/dev/null | jq -r '.overall' || echo "unknown")
  info "Health check: ${OVERALL}"
else
  warn "Could not resolve health-check URL. Run manually after rotation."
fi

info "Rotation complete. Record this change in your rotation log."
