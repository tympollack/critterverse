# Critterverse — Alpha Build
### DePIN Gamified Civic Cleanup · Phase 1: Subterranean Scavenger

---

## Project Structure

```
critterverse/
├── migrations/
│   ├── 001_schema_init.sql          Extensions, schema creation, grants
│   ├── 002_critterverse_core.sql    users, trust_events, bounties, submissions
│   ├── 003_pipeline.sql             pipeline_events, anomalous_archive_queue, pedometer_bounds
│   ├── 004_trust_graph.sql          sunshade_trust_edges, user_effective_trust view
│   ├── 005_council.sql              council_sessions, council_voter_selection, council_votes
│   ├── 006_bridge.sql               patchwork_bridge.webhook_ingestion, outbound_pings
│   ├── 007_cross_app.sql            cross_app_identity_links, cross_app_unlocks, critter_species, user_critters
│   ├── 008_functions.sql            All critterverse.* SQL functions
│   ├── 009_rls.sql                  Full RLS policy layer
│   └── 010_seed_alpha.sql           Phase 1 alpha bounties, critter species
│
└── supabase/
    ├── config.toml
    └── functions/
        ├── _shared/
        │   ├── clients.ts           Dual-context Supabase client factory
        │   ├── pipeline_logger.ts   Pipeline event logging utilities
        │   └── hmac.ts              HMAC-SHA256 verification and signing
        ├── identity/
        │   ├── bootstrap/           SunShade DID → Critterverse UUID handshake
        │   └── cross-app-link/      SunShade SSO, PatchWork accuracy, unlock grants
        ├── pipeline/
        │   ├── initiate/            Submission creation, pedometer bounds, ZKP trigger
        │   ├── zkp-callback/        ZKP result receiver, advances submission state
        │   └── hash-process/        pHash, semantic hash, AI classify, archive routing
        ├── council/
        │   ├── select-voters/       N-hop CTE voter selection, session creation
        │   ├── vote/                Blind commitment + stake locking
        │   ├── reveal/              Plaintext reveal + hash verification
        │   └── resolve/             CRON: Schelling Point resolution
        ├── trust/
        │   ├── slash/               Trust chain slashing (internal only)
        │   ├── quarantine/          Lazy-evaluation effective trust state
        │   ├── redemption-t1/       Quarantine decay via baseline verifications
        │   └── redemption-t2/       Gopher Task assignment + completion
        ├── bridge/
        │   ├── patchwork-inbound/   HMAC verify, translate PatchWork events → bounties
        │   ├── patchwork-outbound/  Fire-and-forget civic audit confirmation
        │   └── retry-pings/         CRON: retry failed outbound pings (max 3 attempts)
        ├── public/
        │   └── bounty-indicators/   Public easter egg marker API for PatchWork UI
        └── sync/
            ├── sunshade-mirror/     CRON: nightly SunShade trust graph delta sync
            └── bounty-maintenance/  CRON: bounty hygiene, council queue, invite expiry
```

---

## Prerequisites

- Supabase CLI `>= 1.142.0`
- Deno `>= 1.40.0`
- PostgreSQL 15 (via Supabase)
- Active SunShade Hub integration (bootstrap secret pre-provisioned)
- Active ZKP pipeline endpoint
- Active AI vision model endpoint

---

## Deploy Guide

### Step 1 — Supabase Project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### Step 2 — Secrets

Set all required secrets before running migrations or deploying functions.
Never commit secrets to source control.

```bash
# SunShade / Auth
supabase secrets set CRITTERVERSE_BOOTSTRAP_SECRET=<generate-with-openssl-rand-hex-32>
supabase secrets set TRUST_CHAIN_GENESIS_HASH=a3f8c2d1e9b047561a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4
supabase secrets set INTERNAL_FUNCTION_KEY=<generate-with-openssl-rand-hex-32>

# ZKP pipeline
supabase secrets set ZKP_PIPELINE_ENDPOINT=https://zkp.your-pipeline.xyz/validate
supabase secrets set ZKP_PIPELINE_API_KEY=<zkp-api-key>

# AI vision + perceptual hash
supabase secrets set VISION_MODEL_ENDPOINT=https://vision.your-model.xyz/classify
supabase secrets set VISION_MODEL_API_KEY=<vision-api-key>
supabase secrets set PHASH_SERVICE_ENDPOINT=https://phash.your-service.xyz/hash

# PatchWork bridge
supabase secrets set PATCHWORK_WEBHOOK_SECRET=<shared-with-patchwork-team>
supabase secrets set PATCHWORK_AUDIT_WEBHOOK_URL=https://api.patchwork.city/audit/confirm
supabase secrets set CRITTERVERSE_OUTBOUND_SECRET=<shared-with-patchwork-team>
supabase secrets set PATCHWORK_PUBLIC_API=https://api.patchwork.city/public

# SunShade graph sync
supabase secrets set SUNSHADE_GRAPH_API=https://graph.sunshade.network
supabase secrets set SUNSHADE_API_KEY=<sunshade-api-key>
```

### Step 3 — PostgREST Schema Exposure

In the Supabase Dashboard:
**Project Settings → API → Exposed Schemas**

Set to exactly:
```
critterverse
```

`patchwork_bridge` must **never** appear in this list.

### Step 4 — JWT Configuration

In the Supabase Dashboard:
**Project Settings → Auth → JWT Settings**

```
JWT Secret:  <same HS256 key used by SunShade Hub to sign tokens>
JWT Expiry:  3600
```

Disable all native auth providers:
**Authentication → Providers** → disable Email, Phone, Google, GitHub, Apple, and all others.

### Step 5 — Run Migrations

```bash
supabase db push
```

Migrations run in numeric order (001 → 010). Each migration is idempotent.

Verify the schema boundary:

```sql
-- Should list critterverse tables
SELECT tablename FROM pg_tables WHERE schemaname = 'critterverse';

-- Should return 0 rows for authenticated role
SET ROLE authenticated;
SELECT tablename FROM pg_tables WHERE schemaname = 'patchwork_bridge';
-- Expected: permission denied or 0 rows
```

### Step 6 — Deploy Edge Functions

```bash
supabase functions deploy --no-verify-jwt public/bounty-indicators
supabase functions deploy identity/bootstrap
supabase functions deploy identity/cross-app-link
supabase functions deploy pipeline/initiate
supabase functions deploy pipeline/zkp-callback
supabase functions deploy pipeline/hash-process
supabase functions deploy council/select-voters
supabase functions deploy council/vote
supabase functions deploy council/reveal
supabase functions deploy council/resolve
supabase functions deploy trust/slash
supabase functions deploy trust/quarantine
supabase functions deploy trust/redemption-t1
supabase functions deploy trust/redemption-t2
supabase functions deploy bridge/patchwork-inbound
supabase functions deploy bridge/patchwork-outbound
supabase functions deploy bridge/retry-pings
supabase functions deploy sync/sunshade-mirror
supabase functions deploy sync/bounty-maintenance
```

Note: `public/bounty-indicators` is deployed with `--no-verify-jwt` as it is intentionally unauthenticated.

### Step 7 — Configure CRON Jobs

Run in the Supabase SQL editor (requires `pg_net` and `pg_cron` extensions):

```sql
SELECT cron.schedule(
  'council-resolve',
  '*/30 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/council/resolve',
    headers := jsonb_build_object('X-Internal-Key', current_setting('app.internal_key')),
    body    := '{}'::jsonb
  )$$
);

SELECT cron.schedule(
  'bridge-retry-pings',
  '*/15 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/bridge/retry-pings',
    headers := jsonb_build_object('X-Internal-Key', current_setting('app.internal_key')),
    body    := '{}'::jsonb
  )$$
);

SELECT cron.schedule(
  'sync-sunshade-mirror',
  '0 0 * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/sync/sunshade-mirror',
    headers := jsonb_build_object('X-Internal-Key', current_setting('app.internal_key')),
    body    := '{}'::jsonb
  )$$
);

SELECT cron.schedule(
  'sync-bounty-maintenance',
  '0 */6 * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/sync/bounty-maintenance',
    headers := jsonb_build_object('X-Internal-Key', current_setting('app.internal_key')),
    body    := '{}'::jsonb
  )$$
);
```

---

## Key Architectural Contracts

### Authentication Flow
1. User authenticates with SunShade Hub
2. SunShade calls `identity/bootstrap` with `CRITTERVERSE_BOOTSTRAP_SECRET` (first-time only)
3. SunShade mints HS256 JWT: `{ aud, iss, role, sub, sunshade_node_hash, sunshade_path, trust_state, exp }`
4. Mobile client initialises Supabase client with SunShade JWT
5. All queries are governed by RLS policies using `auth.uid()` and `auth.jwt()`

### Schema Boundary
- `critterverse.*` — exposed via PostgREST, governed by RLS, accessible to authenticated clients
- `patchwork_bridge.*` — never exposed, service_role only, append-only webhook log

### Data Flow (PatchWork → Critterverse)
```
PatchWork webhook → bridge/patchwork-inbound → patchwork_bridge.webhook_ingestion (log)
                                              → critterverse.bounties (translated, soft ref)
```

### Data Flow (Critterverse → PatchWork)
```
pipeline/hash-process (verified civic_audit)
  → bridge/patchwork-outbound (fire-and-forget, no game state crosses boundary)
  → patchwork_bridge.outbound_pings (audit log)
```

---

## Phase Completion Checklist

### Phase 1: Subterranean Scavenger (Alpha)
- [ ] Migrations 001–010 applied and verified
- [ ] All Edge Functions deployed
- [ ] CRON jobs scheduled
- [ ] PostgREST schema exposure set to `critterverse` only
- [ ] Native GoTrue auth providers disabled
- [ ] JWT shared secret aligned between SunShade and Supabase
- [ ] PatchWork team provided `PATCHWORK_WEBHOOK_SECRET`
- [ ] Alpha seed bounties visible in app map
- [ ] Offline Secure Enclave bundle format agreed with mobile team
- [ ] ZKP pipeline callback endpoint registered with ZKP team

### Phase 2: Scavenger Council
- [ ] Council voter acceptance flow in mobile UX
- [ ] Blind commitment + reveal UI
- [ ] `council/resolve` CRON verified in staging

### Phase 3: Trust Ledger
- [ ] SunShade webhook for trust invalidation on slash
- [ ] Quarantine UX: reduced bounty map, decay progress bar
- [ ] Redemption Arc: Gopher Task map overlay

### Phase 3.5: The Bridge (Cross-Pollination)
- [ ] PatchWork team enables easter egg feature flag
- [ ] `public/bounty-indicators` rate limit configured
- [ ] Cross-app unlock flow E2E tested with PatchWork staging DID

### Phase 4: Full Critterverse
- [ ] Critter drop UI and collection screen
- [ ] Species rarity animation system
- [ ] On-chain mint provenance via mint_seed

---

*Critterverse Alpha Build — Internal Engineering*
*Do not distribute. Classification: Confidential.*
