# Critterverse Deployment Checklist

Authoritative checklist for every staging and production deploy.
Run through this in order. Do not skip steps.

---

## Pre-Deploy: First-Time Setup (run once per environment)

### Infrastructure

- [ ] Supabase project created and linked: `supabase link --project-ref <ref>`
- [ ] PostgreSQL 15 confirmed in project settings
- [ ] SunShade Hub has provisioned the HS256 signing key for this environment

### Secrets (verify with `supabase secrets list`)

- [ ] `CRITTERVERSE_BOOTSTRAP_SECRET` — 32-byte hex, shared with SunShade Hub
- [ ] `TRUST_CHAIN_GENESIS_HASH` — must be `a3f8c2d1e9b047561a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4` in ALL environments
- [ ] `INTERNAL_FUNCTION_KEY` — 32-byte hex, env-unique
- [ ] `ZKP_PIPELINE_ENDPOINT` — external ZKP validation service URL
- [ ] `ZKP_PIPELINE_API_KEY` — ZKP service auth
- [ ] `VISION_MODEL_ENDPOINT` — AI classification service URL
- [ ] `VISION_MODEL_API_KEY` — vision service auth
- [ ] `PHASH_SERVICE_ENDPOINT` — perceptual hash service URL
- [ ] `PATCHWORK_WEBHOOK_SECRET` — 32-byte hex, shared with PatchWork team
- [ ] `PATCHWORK_AUDIT_WEBHOOK_URL` — PatchWork confirmation endpoint
- [ ] `CRITTERVERSE_OUTBOUND_SECRET` — 32-byte hex, shared with PatchWork team
- [ ] `PATCHWORK_PUBLIC_API` — PatchWork public DID profile API base URL
- [ ] `SUNSHADE_GRAPH_API` — SunShade trust graph delta API
- [ ] `SUNSHADE_API_KEY` — SunShade API auth

### Supabase Dashboard Settings (manual, cannot be scripted)

- [ ] **Auth → JWT Settings → JWT Secret** = SunShade's HS256 signing key (must match exactly)
- [ ] **Auth → JWT Settings → JWT Expiry** = `3600`
- [ ] **Auth → Providers → Email**: DISABLED
- [ ] **Auth → Providers → Phone**: DISABLED
- [ ] **Auth → Providers → Google**: DISABLED
- [ ] **Auth → Providers → GitHub**: DISABLED
- [ ] **Auth → Providers → Apple**: DISABLED
- [ ] **API → Exposed Schemas** = `critterverse` (only — not `patchwork_bridge`, not `public`)

---

## Every Deploy

### Step 1 — Run migrations

```bash
supabase db push
```

Expected output: `Applying migration 001_schema_init.sql ... 016_analytics_views.sql`

### Step 2 — Validate schema integrity

```bash
bash scripts/check-schema.sh --project-ref <ref>
```

Expected: all checks PASS or WARN (no FAIL). A FAIL exits with code 1 and **must block the deploy**.

Key checks performed automatically:
- Both schemas exist (`critterverse`, `patchwork_bridge`)
- All 15 `critterverse` tables present with RLS enabled
- Both `patchwork_bridge` tables present
- Zero DML grants to `authenticated`/`anon` on `patchwork_bridge`
- ≤ 9 EXECUTE grants to `authenticated` on `critterverse` functions
- 5 privileged functions NOT executable by `authenticated`
- Append-only rules on `trust_events` and `webhook_ingestion`
- Critical performance indexes present
- 4 CRON jobs scheduled
- Alpha seed data present

### Step 3 — Deploy Edge Functions

```bash
# Single command deploys all 29 authenticated functions + 2 public
bash scripts/deploy.sh --project-ref <ref> --env <staging|production>
```

Functions deployed in this run (29 total):

**identity:** bootstrap, cross-app-link  
**pipeline:** initiate, zkp-callback, hash-process, offline-sync  
**council:** select-voters, accept, vote, reveal, resolve, voter-status  
**trust:** slash, quarantine, redemption-t1, redemption-t2  
**bridge:** patchwork-inbound, patchwork-outbound, retry-pings  
**user:** profile  
**public:** bounty-indicators (no-verify-jwt), submission-status  
**sync:** sunshade-mirror, bounty-maintenance  
**admin:** health-check, pipeline-audit, user-report, analytics  

### Step 4 — Configure CRON jobs (if not already set)

```bash
supabase db execute --project-ref <ref> "
  ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
  ALTER DATABASE postgres SET app.internal_key = '<INTERNAL_FUNCTION_KEY>';
"
```

Then verify in Dashboard → Database → Cron Jobs (4 jobs expected):
- `critterverse-council-resolve` — `*/30 * * * *`
- `critterverse-bridge-retry-pings` — `*/15 * * * *`
- `critterverse-sunshade-mirror` — `0 0 * * *`
- `critterverse-bounty-maintenance` — `0 */6 * * *`

### Step 5 — Health check

```bash
curl -s -H "X-Internal-Key: $INTERNAL_FUNCTION_KEY" \
  https://<ref>.supabase.co/functions/v1/admin/health-check | jq '.overall'
```

Expected: `"ok"`. A `"warn"` requires investigation before production deploy. A `"error"` **blocks production deploy**.

Individual subsystems checked:
- `db_connectivity` — critterverse schema reachable
- `bridge_backlog` — no webhooks stuck in pending > 5 min
- `outbound_pings` — failure count within threshold
- `anomalous_queue` — queue depth and critical item count
- `council_sessions` — no sessions past reveal_deadline unresolved
- `trust_chain_integrity` — spot-check on 10 recent users
- `sunshade_mirror` — last sync within 26h

### Step 6 — Smoke test pipeline

```bash
# Test the public indicator endpoint (no auth required)
curl -s "https://<ref>.supabase.co/functions/v1/public/bounty-indicators?lat=37.77&lng=-122.41"
# Expected: { "indicators": [...] }

# Test the analytics manifest (internal key required)
curl -s -H "X-Internal-Key: $INTERNAL_FUNCTION_KEY" \
  "https://<ref>.supabase.co/functions/v1/admin/analytics"
# Expected: { "available_views": [...], "usage": "..." }
```

### Step 7 — Notify PatchWork team (if webhook secret was rotated)

If `PATCHWORK_WEBHOOK_SECRET` was changed in this deploy, share the new value with the PatchWork team through a secure channel. Until they update their signing config, all inbound webhooks will fail HMAC verification and be logged as `hmac_verified=false`.

---

## Post-Deploy Verification (production only)

Run these queries in the Supabase SQL editor or via `supabase db execute`:

```sql
-- Confirm no DML grants leaked to clients
SELECT count(*) FROM information_schema.table_privileges
WHERE table_schema = 'patchwork_bridge'
  AND grantee IN ('authenticated','anon')
  AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');
-- Must be 0

-- Confirm authenticated function whitelist size
SELECT count(*) FROM information_schema.routine_privileges
WHERE grantee = 'authenticated' AND routine_schema = 'critterverse';
-- Must be ≤ 9

-- Check for any broken trust chains (full scan — run off-peak)
SELECT id, chain_length, broken_at_seq
FROM critterverse.verify_trust_chain(id)
WHERE is_valid = FALSE
LIMIT 10;
-- Must return 0 rows
```

---

## Rollback Procedure

Critterverse uses append-only migrations. Rollback means:
1. Deploy the previous version of all Edge Functions
2. The schema state remains at the current migration level
3. If a migration introduced a breaking change, write a compensating migration (e.g., `017_rollback_bounty_column.sql`)

**Never run `supabase db reset` on a production database.** It wipes all data.

For Edge Function rollback:
```bash
# Deploy a specific tagged version of functions
git checkout <previous-tag>
bash scripts/deploy.sh --project-ref <ref> --env production
```

---

## Secret Rotation (in-flight)

Use `scripts/rotate-secrets.sh` for all secrets except `JWT_SECRET`.

For `JWT_SECRET` (SunShade signing key), coordinate with the SunShade team:
1. Schedule a maintenance window
2. Generate new key: `openssl rand -hex 32`
3. Update SunShade Hub signing config first
4. Update Supabase Dashboard JWT Secret within 60 seconds
5. All active sessions invalidate; users re-authenticate on next request

See `SECURITY.md §7` for full rotation schedule.

---

## Key Contacts

| System | Owner | Escalation Path |
|---|---|---|
| SunShade Hub | SunShade team | Token/JWT issues, bootstrap failures |
| PatchWork API | PatchWork engineering | Webhook delivery, audit ping failures |
| ZKP Pipeline | ZKP team | Validation failures, callback delays |
| Vision Model | ML team | AI confidence degradation, timeout errors |
