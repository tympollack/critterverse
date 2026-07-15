# Critterverse: Implementation Plan v0.3
### Senior Architect Review — Schema Namespacing + SunShade Auth Dominance
---

## What Changed from v0.2

| Component | v0.2 | v0.3 |
|---|---|---|
| Schema namespace | All objects in implicit `public` | **Explicit `critterverse` and `patchwork_bridge` schemas** |
| Table prefixing | `CREATE TABLE critterverse_bounties` | `CREATE TABLE critterverse.bounties` |
| Bridge tables | `CREATE TABLE patchwork_webhook_ingestion` | `CREATE TABLE patchwork_bridge.webhook_ingestion` |
| Function ownership | `public` functions | Schema-qualified: `critterverse.resolve_council_session()` etc. |
| PostgREST exposure | Implicit public exposure | **Explicit schema exposure list; `patchwork_bridge` never exposed** |
| Identity Provider | SunShade implied; Supabase GoTrue assumed | **SunShade is the sole IdP; GoTrue validates only, never issues** |
| JWT structure | Unspecified | **Formal payload contract with `sunshade_node_hash` custom claim** |
| User bootstrap | Edge Function mentioned, not specified | **Full DID → Critterverse UUID bootstrap handshake defined** |
| RLS | Absent | **Comprehensive policy layer for all tables using `auth.jwt()`** |
| Edge Function auth | Single service-role pattern | **Dual-context pattern: user-JWT or service role per operation** |

All bridge logic, N-hop CTE, council voting, trust chain, Redemption Arc, and easter egg API carry forward from v0.2 with schema-prefix updates only. Only new or structurally changed content is written in full below.

---

## Section 1: Schema Namespace Migration

### 1.1 Schema Initialization

This block heads every migration file. It is idempotent and must run before any object creation.

```sql
-- ============================================================
-- SCHEMA INITIALIZATION
-- Run once at project bootstrap. All subsequent migrations
-- must explicitly prefix every object with its schema.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS critterverse;
CREATE SCHEMA IF NOT EXISTS patchwork_bridge;

-- Grant usage to PostgREST roles
-- critterverse is exposed; patchwork_bridge is Edge Function only
GRANT USAGE ON SCHEMA critterverse     TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA patchwork_bridge TO service_role;  -- service_role only

-- Default privileges: future tables in critterverse are readable
-- by authenticated; patchwork_bridge is service_role only
ALTER DEFAULT PRIVILEGES IN SCHEMA critterverse
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA critterverse
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA patchwork_bridge
  GRANT ALL ON TABLES TO service_role;

-- Ensure PostgREST picks up schema-qualified functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA critterverse TO authenticated, service_role;
```

### 1.2 Canonical Object Name Map

Every object from v0.1/v0.2 and its v0.3 qualified name:

| v0.1/v0.2 Name | v0.3 Qualified Name | Notes |
|---|---|---|
| `users` | `critterverse.users` | |
| `trust_events` | `critterverse.trust_events` | |
| `critterverse_bounties` | `critterverse.bounties` | Renamed for namespace clarity |
| `submissions` | `critterverse.submissions` | |
| `pipeline_events` | `critterverse.pipeline_events` | |
| `anomalous_archive_queue` | `critterverse.anomalous_archive_queue` | |
| `pedometer_bounds` | `critterverse.pedometer_bounds` | |
| `sunshade_trust_edges` | `critterverse.sunshade_trust_edges` | |
| `council_sessions` | `critterverse.council_sessions` | |
| `council_voter_selection` | `critterverse.council_voter_selection` | |
| `council_votes` | `critterverse.council_votes` | |
| `critter_species` | `critterverse.critter_species` | |
| `user_critters` | `critterverse.user_critters` | |
| `cross_app_identity_links` | `critterverse.cross_app_identity_links` | |
| `cross_app_unlocks` | `critterverse.cross_app_unlocks` | |
| `patchwork_webhook_ingestion` | `patchwork_bridge.webhook_ingestion` | Schema rename |
| `patchwork_outbound_pings` | `patchwork_bridge.outbound_pings` | Schema rename |
| `user_effective_trust` (view) | `critterverse.user_effective_trust` | |
| All functions | `critterverse.<function_name>()` | |

### 1.3 Representative DDL — Schema-Qualified

The tables below are shown in full because they carry structural changes beyond a prefix. All other tables from v0.2 are unchanged except for their schema prefix per the name map above.

```sql
-- ============================================================
-- critterverse.users
-- Sub field in SunShade JWT resolves to this table's id.
-- ============================================================
CREATE TABLE critterverse.users (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sunshade_node_hash      TEXT          UNIQUE NOT NULL,
  sunshade_path           ltree         NOT NULL,
  trust_score             NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  trust_state             TEXT          NOT NULL DEFAULT 'active'
                            CHECK (trust_state IN ('active','quarantined','slashed')),
  reputation_balance      NUMERIC(20,8) NOT NULL DEFAULT 0,
  archivist_eligible      BOOLEAN       NOT NULL DEFAULT FALSE,
  avg_stride_cm           NUMERIC(6,2)  NOT NULL DEFAULT 76.0,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cv_users_sunshade_path ON critterverse.users USING GIST (sunshade_path);
CREATE INDEX idx_cv_users_trust_state   ON critterverse.users (trust_state);
CREATE INDEX idx_cv_users_archivist     ON critterverse.users (archivist_eligible)
  WHERE archivist_eligible = TRUE;


-- ============================================================
-- critterverse.bounties
-- Renamed from critterverse_bounties. Prefix now in schema,
-- not in table name. Soft ref to PatchWork unchanged.
-- ============================================================
CREATE TABLE critterverse.bounties (
  id                      UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  geo_lat                 DOUBLE PRECISION NOT NULL,
  geo_lng                 DOUBLE PRECISION NOT NULL,
  bounty_type             TEXT             NOT NULL DEFAULT 'standard'
                            CHECK (bounty_type IN (
                              'standard','high_value','gopher_target',
                              'redemption','civic_audit'
                            )),
  source                  TEXT             NOT NULL DEFAULT 'organic'
                            CHECK (source IN (
                              'organic','patchwork_webhook',
                              'admin_seeded','gopher_routed'
                            )),
  external_patchwork_ref  UUID,            -- soft ref; no REFERENCES constraint
  patchwork_issue_type    TEXT,
  last_verified_at        TIMESTAMPTZ,
  traffic_weight          NUMERIC(10,4)    NOT NULL DEFAULT 1.0,
  is_active               BOOLEAN          NOT NULL DEFAULT TRUE,
  reward_multiplier       NUMERIC(6,4)     NOT NULL DEFAULT 1.0,
  alpha_label             TEXT,
  alpha_is_discovered     BOOLEAN          NOT NULL DEFAULT FALSE,
  patchwork_pinged_at     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cv_bounties_geo     ON critterverse.bounties (geo_lat, geo_lng);
CREATE INDEX idx_cv_bounties_active  ON critterverse.bounties (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_cv_bounties_pwref   ON critterverse.bounties (external_patchwork_ref)
  WHERE external_patchwork_ref IS NOT NULL;


-- ============================================================
-- critterverse.submissions
-- bounty_id references the local critterverse.bounties table.
-- ============================================================
CREATE TABLE critterverse.submissions (
  id                      UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID             NOT NULL REFERENCES critterverse.users(id),
  bounty_id               UUID             NOT NULL REFERENCES critterverse.bounties(id),
  status                  TEXT             NOT NULL DEFAULT 'initiated'
                            CHECK (status IN (
                              'initiated','zkp_pending','zkp_valid','zkp_invalid',
                              'hashing','verified','rejected','anomalous'
                            )),
  perceptual_hash         TEXT,
  semantic_hash           TEXT,
  ai_confidence           NUMERIC(5,4),
  ai_classification       TEXT,
  zkp_proof_cid           TEXT,
  zkp_validated_at        TIMESTAMPTZ,
  submitted_lat           DOUBLE PRECISION,
  submitted_lng           DOUBLE PRECISION,
  exif_lat                DOUBLE PRECISION,
  exif_lng                DOUBLE PRECISION,
  exif_timestamp          TIMESTAMPTZ,
  is_offline_submission   BOOLEAN          NOT NULL DEFAULT FALSE,
  offline_sequence_hash   TEXT,
  offline_synced_at       TIMESTAMPTZ,
  reward_multiplier       NUMERIC(6,4)     NOT NULL DEFAULT 1.0,
  reward_amount           NUMERIC(20,8),
  reward_paid_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  processed_at            TIMESTAMPTZ
);

CREATE INDEX idx_cv_submissions_user   ON critterverse.submissions (user_id, created_at DESC);
CREATE INDEX idx_cv_submissions_bounty ON critterverse.submissions (bounty_id);
CREATE INDEX idx_cv_submissions_status ON critterverse.submissions (status);
CREATE INDEX idx_cv_submissions_phash  ON critterverse.submissions (perceptual_hash)
  WHERE perceptual_hash IS NOT NULL;


-- ============================================================
-- patchwork_bridge.webhook_ingestion
-- Renamed from patchwork_webhook_ingestion.
-- Not exposed via PostgREST; service_role only.
-- ============================================================
CREATE TABLE patchwork_bridge.webhook_ingestion (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patchwork_event_id      TEXT        NOT NULL UNIQUE,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload             JSONB       NOT NULL,
  hmac_signature          TEXT        NOT NULL,
  hmac_verified           BOOLEAN     NOT NULL,
  translation_status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (translation_status IN (
                              'pending','translated','ignored','duplicate','failed'
                            )),
  translated_bounty_id    UUID        REFERENCES critterverse.bounties(id),
  translation_notes       TEXT,
  processed_at            TIMESTAMPTZ
);

CREATE RULE bridge_webhook_no_update AS
  ON UPDATE TO patchwork_bridge.webhook_ingestion DO INSTEAD NOTHING;
CREATE RULE bridge_webhook_no_delete AS
  ON DELETE TO patchwork_bridge.webhook_ingestion DO INSTEAD NOTHING;

CREATE INDEX idx_bridge_event_id  ON patchwork_bridge.webhook_ingestion (patchwork_event_id);
CREATE INDEX idx_bridge_status    ON patchwork_bridge.webhook_ingestion (translation_status);


-- ============================================================
-- patchwork_bridge.outbound_pings
-- Renamed from patchwork_outbound_pings.
-- Not exposed via PostgREST; service_role only.
-- ============================================================
CREATE TABLE patchwork_bridge.outbound_pings (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id           UUID        NOT NULL REFERENCES critterverse.submissions(id),
  bounty_id               UUID        NOT NULL REFERENCES critterverse.bounties(id),
  patchwork_event_id      TEXT        NOT NULL,
  ping_status             TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (ping_status IN (
                              'pending','sent','acknowledged','failed','skipped'
                            )),
  attempts                INTEGER     NOT NULL DEFAULT 0,
  last_attempted_at       TIMESTAMPTZ,
  acknowledged_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bridge_ping_status ON patchwork_bridge.outbound_pings (ping_status)
  WHERE ping_status IN ('pending','failed');


-- ============================================================
-- Schema-qualified functions (representative set)
-- Full function bodies unchanged from v0.2 except for
-- schema-qualified table references within function bodies.
-- ============================================================

-- Staleness scorer
CREATE OR REPLACE FUNCTION critterverse.bounty_staleness_score(node critterverse.bounties)
RETURNS NUMERIC AS $$
  SELECT CASE
    WHEN node.last_verified_at IS NULL THEN 9999
    ELSE (EXTRACT(EPOCH FROM NOW() - node.last_verified_at) / 3600.0)
         / NULLIF(node.traffic_weight, 0)
  END;
$$ LANGUAGE SQL STABLE;

-- Pedometer bounds helper
CREATE OR REPLACE FUNCTION critterverse.compute_pedometer_bounds(
  distance_m   NUMERIC,
  stride_cm    NUMERIC,
  variance_pct NUMERIC DEFAULT 0.20
) RETURNS TABLE (expected_steps INTEGER, min_steps INTEGER, max_steps INTEGER) AS $$
DECLARE
  stride_m  NUMERIC := stride_cm / 100.0;
  exp_steps INTEGER;
BEGIN
  exp_steps := CEIL(distance_m / stride_m)::INTEGER;
  RETURN QUERY SELECT
    exp_steps,
    FLOOR(exp_steps * (1 - variance_pct))::INTEGER,
    CEIL(exp_steps  * (1 + variance_pct))::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE;

-- Public bounty indicators (easter egg API backing function)
CREATE OR REPLACE FUNCTION critterverse.get_bounty_indicators(
  p_lat       DOUBLE PRECISION,
  p_lng       DOUBLE PRECISION,
  p_radius_km NUMERIC DEFAULT 2.0
) RETURNS TABLE (external_patchwork_ref UUID, marker_style TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.external_patchwork_ref,
    CASE
      WHEN b.bounty_type = 'civic_audit' AND b.reward_multiplier >= 2.5 THEN 'critter_civic'
      WHEN b.bounty_type = 'high_value'                                 THEN 'critter_rare'
      ELSE                                                                   'critter_active'
    END
  FROM critterverse.bounties b
  WHERE b.is_active = TRUE
    AND b.external_patchwork_ref IS NOT NULL
    AND (6371 * acos(
      cos(radians(p_lat)) * cos(radians(b.geo_lat))
      * cos(radians(b.geo_lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(b.geo_lat))
    )) <= p_radius_km;
END;
$$ LANGUAGE plpgsql STABLE;
```

---

## Section 2: PostgREST Exposure Configuration

Supabase's auto-generated REST API exposes the `public` schema by default. Since all objects have been moved out of `public`, explicit configuration is required.

### 2.1 Supabase Dashboard Settings

Navigate to **Project Settings → API → Exposed Schemas** and set:

```
critterverse
```

`patchwork_bridge` must **not** appear in this list. Ever. It is accessible exclusively via Edge Functions using the service role key. No client — including an authenticated, trusted user — can reach bridge tables through PostgREST.

### 2.2 Verification Query

After applying the migration and updating the setting, verify the exposure boundary:

```sql
-- Should return tables from critterverse schema
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'critterverse'
ORDER BY tablename;

-- Should return zero rows from PostgREST's perspective
-- (run as 'authenticated' role, not service_role)
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'patchwork_bridge';
-- Expected: 0 rows (RLS + GRANT blocks visibility)
```

### 2.3 Edge Function Table Reference Pattern

All Edge Functions must use schema-qualified table names in Supabase client calls:

```typescript
// CORRECT — explicit schema in from()
const { data } = await supabase
  .from('critterverse.bounties')
  .select('*')

// ALSO CORRECT — for patchwork_bridge (service_role context only)
const { data } = await supabaseServiceRole
  .from('patchwork_bridge.webhook_ingestion')
  .insert({ ... })

// INCORRECT — will fail now that public schema has no tables
const { data } = await supabase.from('bounties').select('*')
```

---

## Section 3: SunShade as Primary Identity Provider

### 3.1 Architecture Principle

Supabase's GoTrue service is configured in **passive validation mode**: it verifies tokens but never issues them. SunShade is the sole token authority. This ensures that a Critterverse database row, RLS policy, or audit log can always be traced back to a cryptographically verified SunShade DID — never to a Supabase-managed credential that exists independently of the trust graph.

```
User                SunShade Hub               Critterverse Supabase
 │                      │                              │
 │──── Auth Request ───▶│                              │
 │                      │── Bootstrap (first time) ───▶│
 │                      │◀─ { critterverse_user_id } ──│
 │                      │                              │
 │                      │  Mint JWT (HS256)            │
 │◀── JWT ─────────────│  sub = critterverse_user_id  │
 │                      │  sunshade_node_hash = DID    │
 │                      │                              │
 │── Supabase client ──────────────────────────────────▶│
 │   with SunShade JWT                       GoTrue validates
 │                                           against shared secret
 │                                           auth.uid() = sub
 │                                           auth.jwt() = full payload
```

### 3.2 JWT Payload Contract

SunShade must mint tokens that conform exactly to this structure. Any deviation will cause GoTrue validation or RLS policy evaluation to fail silently or incorrectly.

```json
{
  "aud":                  "authenticated",
  "iss":                  "https://sunshade.network",
  "role":                 "authenticated",
  "sub":                  "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "sunshade_node_hash":   "0xabc123def456...",
  "sunshade_path":        "root.branch_a.cluster_03.leaf_001",
  "trust_state":          "active",
  "iat":                  1718036400,
  "exp":                  1718040000
}
```

**Field requirements:**

| Field | Required | Purpose |
|---|---|---|
| `aud` | Yes | Must be `"authenticated"` — GoTrue rejects any other value |
| `iss` | Yes | SunShade's canonical domain. Supabase validates this |
| `role` | Yes | Must be `"authenticated"` to trigger RLS policy evaluation |
| `sub` | Yes | The Critterverse `critterverse.users.id` UUID. Becomes `auth.uid()` in Postgres |
| `sunshade_node_hash` | Yes | DID hash. Available in RLS via `auth.jwt() ->> 'sunshade_node_hash'` |
| `sunshade_path` | Recommended | ltree path. Enables path-aware RLS without a join to `critterverse.users` |
| `trust_state` | Recommended | Cached state. Allows lightweight quarantine checks in RLS |
| `iat` / `exp` | Yes | Standard issue/expiry. Token lifetime: 60 minutes |

**What is deliberately absent from the JWT:**
- `reputation_balance` — mutable; cached value creates a consistency window
- `archivist_eligible` — mutable; Council selection queries the DB directly
- Any PatchWork data — the boundary must be absolute even inside a token

### 3.3 Supabase GoTrue Configuration

In **Project Settings → Auth → JWT Settings**:

```
JWT Secret:     <shared HS256 secret, identical to SunShade's signing key>
JWT Expiry:     3600   (must match SunShade's exp window)
```

The `JWT Secret` is a symmetric key shared between SunShade and Supabase. It is stored in SunShade's secrets vault and in Supabase's environment — never in application code, never in the Edge Function environment as a readable variable.

Disable all Supabase-native auth providers (email, OAuth, magic link) in the dashboard. The only valid authentication path is a SunShade-issued JWT. Leaving native providers active creates an authentication bypass surface.

### 3.4 User Bootstrap Handshake

The first time a SunShade DID is used with Critterverse, SunShade does not yet have a `critterverse_user_id` to embed in `sub`. The following handshake resolves this exactly once per DID.

```
Step 1: User authenticates with SunShade for the first time on Critterverse.

Step 2: SunShade checks its own registry:
        Does DID 0xabc123... have a critterverse_user_id entry? → NO

Step 3: SunShade calls the Critterverse bootstrap endpoint:
        POST /functions/v1/identity/bootstrap
        Authorization: Bearer <CRITTERVERSE_BOOTSTRAP_SECRET>  (pre-shared, not user JWT)
        Body: { "sunshade_node_hash": "0xabc123...", "sunshade_path": "root.branch_a..." }

Step 4: Critterverse Edge Function (service role):
        - Verifies bootstrap secret
        - INSERTs into critterverse.users
        - Appends trust.established event to critterverse.trust_events
        - Returns: { "critterverse_user_id": "d290f1ee-..." }

Step 5: SunShade stores the mapping in its own registry:
        DID 0xabc123... → critterverse_user_id d290f1ee-...

Step 6: SunShade mints JWT with sub = "d290f1ee-..."
        Returns JWT to the mobile client.

Step 7: All subsequent logins for this DID skip Steps 3–5.
        SunShade resolves from its registry and mints immediately.
```

**Bootstrap Edge Function:**

```typescript
// supabase/functions/identity/bootstrap/index.ts
// Called by SunShade Hub only. Never called by mobile clients.

Deno.serve(async (req: Request) => {
  // Verify this is SunShade calling, not a mobile client
  const authHeader = req.headers.get('Authorization') ?? ''
  const bootstrapSecret = Deno.env.get('CRITTERVERSE_BOOTSTRAP_SECRET')!

  if (authHeader !== `Bearer ${bootstrapSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const { sunshade_node_hash, sunshade_path } = await req.json()

  // Validate inputs
  if (!sunshade_node_hash || !sunshade_path) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Idempotency: return existing user if already bootstrapped
  const { data: existing } = await supabase
    .from('critterverse.users')
    .select('id')
    .eq('sunshade_node_hash', sunshade_node_hash)
    .maybeSingle()

  if (existing) {
    return new Response(
      JSON.stringify({ critterverse_user_id: existing.id, bootstrapped: false }),
      { status: 200 }
    )
  }

  // Create the user
  const { data: user, error } = await supabase
    .from('critterverse.users')
    .insert({ sunshade_node_hash, sunshade_path })
    .select('id')
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Establish the root of the trust chain
  const genesisHash = Deno.env.get('TRUST_CHAIN_GENESIS_HASH')!
  const eventData = { reason: 'initial_registration', sunshade_node_hash }
  const currentHash = await sha256Hex(genesisHash + JSON.stringify(eventData))

  await supabase.from('critterverse.trust_events').insert({
    user_id:        user.id,
    previous_hash:  genesisHash,
    current_hash:   currentHash,
    event_type:     'trust.established',
    event_data:     eventData
  })

  return new Response(
    JSON.stringify({ critterverse_user_id: user.id, bootstrapped: true }),
    { status: 201 }
  )
})
```

### 3.5 Token Refresh Flow

Token expiry is managed by the mobile client requesting a new JWT from SunShade — not from Supabase GoTrue. The client must never call any Supabase auth refresh endpoint.

```typescript
// Mobile client: token refresh pattern
class SunShadeTokenManager {
  private jwt: string
  private expiresAt: number

  async getValidToken(): Promise<string> {
    if (Date.now() / 1000 < this.expiresAt - 120) {
      return this.jwt   // still valid with 2 min buffer
    }
    // Request new token from SunShade hub
    const response = await fetch(`${SUNSHADE_HUB}/token/refresh`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.currentRefreshToken}` }
    })
    const { jwt, expires_at } = await response.json()
    this.jwt = jwt
    this.expiresAt = expires_at
    return this.jwt
  }
}

// Supabase client initialized with live token getter
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: async (url, options = {}) => {
      const token = await tokenManager.getValidToken()
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`
        }
      })
    }
  }
})
```

---

## Section 4: Row Level Security Policy Layer

RLS is enabled on every `critterverse` schema table. `patchwork_bridge` tables need no RLS because they are inaccessible to the `authenticated` and `anon` roles entirely via the `GRANT` structure.

### 4.1 Policy Conventions

All policies use two Postgres functions from the SunShade JWT:

```sql
-- Standard Supabase: resolves to JWT.sub (the Critterverse user UUID)
auth.uid()

-- Full JWT payload as JSONB — any custom claim is accessible
auth.jwt() ->> 'sunshade_node_hash'   -- TEXT
auth.jwt() ->> 'sunshade_path'        -- TEXT (cast to ltree where needed)
auth.jwt() ->> 'trust_state'          -- TEXT cached in token
```

Policies that would be prohibitively expensive to evaluate on every row (e.g., full graph walks) are handled at the Edge Function layer using the service role. The RLS layer enforces ownership and session-scoped access only.

### 4.2 `critterverse.users`

```sql
ALTER TABLE critterverse.users ENABLE ROW LEVEL SECURITY;

-- Users can always read their own record
CREATE POLICY "users_read_own"
ON critterverse.users FOR SELECT
USING (id = auth.uid());

-- Archivists can read other users' trust scores (needed for Council UX)
-- Read access is limited to non-sensitive columns via a view (see §4.11)
CREATE POLICY "archivists_read_trust_scores"
ON critterverse.users FOR SELECT
USING (
  (auth.jwt() ->> 'trust_state') = 'active'
  AND EXISTS (
    SELECT 1 FROM critterverse.users
    WHERE id = auth.uid() AND archivist_eligible = TRUE
  )
);

-- No client INSERT or UPDATE — users are created by the bootstrap Edge Function only
-- (service_role bypasses RLS; no policy needed for service_role writes)
CREATE POLICY "users_no_client_insert"
ON critterverse.users FOR INSERT
WITH CHECK (FALSE);

CREATE POLICY "users_no_client_update"
ON critterverse.users FOR UPDATE
USING (FALSE);
```

### 4.3 `critterverse.trust_events`

```sql
ALTER TABLE critterverse.trust_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own trust chain only
CREATE POLICY "trust_events_read_own"
ON critterverse.trust_events FOR SELECT
USING (user_id = auth.uid());

-- Append-only rules already block UPDATE and DELETE at the rule level
-- Belt-and-suspenders: RLS also blocks client INSERT
CREATE POLICY "trust_events_no_client_write"
ON critterverse.trust_events FOR INSERT
WITH CHECK (FALSE);
```

### 4.4 `critterverse.bounties`

```sql
ALTER TABLE critterverse.bounties ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view active bounties (game map is public)
CREATE POLICY "bounties_read_active"
ON critterverse.bounties FOR SELECT
USING (is_active = TRUE);

-- Quarantined users can only see standard bounties (not high_value or civic_audit)
-- This enforces the reduced-reward quarantine experience at the data layer
CREATE POLICY "quarantined_users_limited_bounties"
ON critterverse.bounties FOR SELECT
USING (
  (auth.jwt() ->> 'trust_state') != 'quarantined'
  OR bounty_type = 'standard'
);

-- No client writes
CREATE POLICY "bounties_no_client_write"
ON critterverse.bounties FOR INSERT WITH CHECK (FALSE);
```

### 4.5 `critterverse.submissions`

```sql
ALTER TABLE critterverse.submissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own submissions
CREATE POLICY "submissions_read_own"
ON critterverse.submissions FOR SELECT
USING (user_id = auth.uid());

-- Accepted Council voters can read the specific submission under review
-- in their active session — but only during the active or reveal phase
CREATE POLICY "archivists_read_council_submission"
ON critterverse.submissions FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM critterverse.council_voter_selection cvs
    JOIN critterverse.council_sessions        cs  ON cs.id  = cvs.session_id
    JOIN critterverse.anomalous_archive_queue aaq ON aaq.council_session_id = cs.id
    WHERE cvs.voter_user_id = auth.uid()
      AND cvs.status        = 'accepted'
      AND aaq.submission_id = submissions.id
      AND cs.session_status IN ('active','reveal_phase')
  )
);

-- Users can only insert submissions that belong to themselves
CREATE POLICY "submissions_insert_own"
ON critterverse.submissions FOR INSERT
WITH CHECK (user_id = auth.uid());

-- No client UPDATE (pipeline Edge Functions use service_role)
CREATE POLICY "submissions_no_client_update"
ON critterverse.submissions FOR UPDATE
USING (FALSE);
```

### 4.6 `critterverse.pipeline_events`

```sql
ALTER TABLE critterverse.pipeline_events ENABLE ROW LEVEL SECURITY;

-- Users can read pipeline events for their own submissions
CREATE POLICY "pipeline_events_read_own"
ON critterverse.pipeline_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM critterverse.submissions s
    WHERE s.id      = pipeline_events.submission_id
      AND s.user_id = auth.uid()
  )
);

CREATE POLICY "pipeline_events_no_client_write"
ON critterverse.pipeline_events FOR INSERT WITH CHECK (FALSE);
```

### 4.7 `critterverse.anomalous_archive_queue`

```sql
ALTER TABLE critterverse.anomalous_archive_queue ENABLE ROW LEVEL SECURITY;

-- Users can see their own archived submissions
CREATE POLICY "anomalous_read_own"
ON critterverse.anomalous_archive_queue FOR SELECT
USING (
  submission_id IN (
    SELECT id FROM critterverse.submissions WHERE user_id = auth.uid()
  )
);

-- Accepted Archivists can read items assigned to their council session
CREATE POLICY "archivists_read_assigned"
ON critterverse.anomalous_archive_queue FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM critterverse.council_voter_selection cvs
    WHERE cvs.session_id    = anomalous_archive_queue.council_session_id
      AND cvs.voter_user_id = auth.uid()
      AND cvs.status        = 'accepted'
  )
);

CREATE POLICY "anomalous_no_client_write"
ON critterverse.anomalous_archive_queue FOR INSERT WITH CHECK (FALSE);
```

### 4.8 `critterverse.council_sessions`

```sql
ALTER TABLE critterverse.council_sessions ENABLE ROW LEVEL SECURITY;

-- Council session metadata is public to all authenticated users
-- (outcome transparency is a trust property of the system)
CREATE POLICY "council_sessions_read_all"
ON critterverse.council_sessions FOR SELECT
USING (TRUE);

CREATE POLICY "council_sessions_no_client_write"
ON critterverse.council_sessions FOR INSERT WITH CHECK (FALSE);
CREATE POLICY "council_sessions_no_client_update"
ON critterverse.council_sessions FOR UPDATE USING (FALSE);
```

### 4.9 `critterverse.council_votes`

This is the most nuanced RLS surface: blind voting requires that a voter cannot see another voter's commitment during the voting phase. The voting deadline column on the session governs the visibility transition.

```sql
ALTER TABLE critterverse.council_votes ENABLE ROW LEVEL SECURITY;

-- During voting phase: voters can only read their own commitment
-- After voting_deadline: all revealed votes become visible (reveal phase)
-- After resolution: all votes are fully visible
CREATE POLICY "votes_read_own_or_post_deadline"
ON critterverse.council_votes FOR SELECT
USING (
  voter_user_id = auth.uid()
  OR
  (
    SELECT cs.voting_deadline < NOW()
    FROM critterverse.council_sessions cs
    WHERE cs.id = council_votes.session_id
  )
);

-- Only accepted voters for the session can commit a vote,
-- and only before the voting deadline
CREATE POLICY "votes_insert_accepted_voters"
ON critterverse.council_votes FOR INSERT
WITH CHECK (
  voter_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM critterverse.council_voter_selection cvs
    JOIN critterverse.council_sessions        cs ON cs.id = cvs.session_id
    WHERE cvs.session_id    = council_votes.session_id
      AND cvs.voter_user_id = auth.uid()
      AND cvs.status        = 'accepted'
      AND cs.voting_deadline > NOW()
      AND cs.session_status  = 'active'
  )
);

-- No client UPDATE (resolution is a service_role operation)
CREATE POLICY "votes_no_client_update"
ON critterverse.council_votes FOR UPDATE USING (FALSE);
```

### 4.10 `critterverse.sunshade_trust_edges`

```sql
ALTER TABLE critterverse.sunshade_trust_edges ENABLE ROW LEVEL SECURITY;

-- Trust graph is readable by all authenticated users
-- (the graph structure is not private; it's used for voter selection UI)
CREATE POLICY "trust_edges_read_all"
ON critterverse.sunshade_trust_edges FOR SELECT
USING (TRUE);

CREATE POLICY "trust_edges_no_client_write"
ON critterverse.sunshade_trust_edges FOR INSERT WITH CHECK (FALSE);
```

### 4.11 `critterverse.cross_app_identity_links` and `critterverse.cross_app_unlocks`

```sql
ALTER TABLE critterverse.cross_app_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE critterverse.cross_app_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "identity_links_read_own"
ON critterverse.cross_app_identity_links FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "identity_links_no_client_write"
ON critterverse.cross_app_identity_links FOR INSERT WITH CHECK (FALSE);

CREATE POLICY "unlocks_read_own"
ON critterverse.cross_app_unlocks FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "unlocks_no_client_write"
ON critterverse.cross_app_unlocks FOR INSERT WITH CHECK (FALSE);
```

### 4.12 Archivist-Safe Public View

Because the `archivists_read_trust_scores` policy on `critterverse.users` grants broad SELECT, a view restricts what columns Archivists can actually see on other users. This is the only object non-owners should query for peer information.

```sql
CREATE VIEW critterverse.archivist_peer_view AS
SELECT
  id,
  sunshade_node_hash,
  -- ltree path exposed only at depth 2 (branch level) to prevent de-anonymisation
  subpath(sunshade_path, 0, 2)  AS branch_path,
  trust_score,
  archivist_eligible,
  trust_state
FROM critterverse.users;

-- View inherits RLS from the underlying table
-- No separate RLS on the view needed
GRANT SELECT ON critterverse.archivist_peer_view TO authenticated;
```

---

## Section 5: Edge Function Auth — Dual-Context Pattern

Every Edge Function now operates in one of two explicit auth contexts. Using the wrong one is a security defect, not a style preference.

```
┌─────────────────────────────────────────────────────────────────┐
│  USER-JWT CONTEXT                                               │
│  Use when: the operation is scoped to the calling user.         │
│  RLS is enforced. User cannot exceed their own permissions.     │
│                                                                 │
│  const supabase = createClient(url, anonKey, {                 │
│    global: { headers: {                                         │
│      Authorization: req.headers.get('Authorization')!           │
│    }}                                                           │
│  })                                                             │
│                                                                 │
│  Examples: submit a bounty, cast a vote, view own trust chain   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SERVICE-ROLE CONTEXT                                           │
│  Use when: the operation is cross-user or system-level.         │
│  RLS is bypassed. Must apply manual authorization logic.        │
│                                                                 │
│  const supabase = createClient(url, serviceRoleKey)            │
│                                                                 │
│  Examples: Council resolution, trust slashing, webhook ingest,  │
│  pedometer bounds calculation, user bootstrap, outbound pings   │
└─────────────────────────────────────────────────────────────────┘
```

**Pattern in practice — `pipeline/initiate`:**

```typescript
// supabase/functions/pipeline/initiate/index.ts

Deno.serve(async (req: Request) => {
  // ── User-JWT context for the INSERT ──────────────────────
  // RLS will enforce user_id = auth.uid() on the submissions table.
  // The client cannot spoof a different user_id — RLS rejects it.
  const supabaseUserCtx = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  )

  // ── Service-role context for system bookkeeping ───────────
  // Pedometer bounds calculation and pipeline event logging
  // touch multiple users' records and bypass RLS intentionally.
  const supabaseSvc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { bounty_id, geo_lat, geo_lng, reported_steps } = await req.json()

  // Validate the calling user from their JWT — no manual lookup needed
  const { data: { user }, error: authError } = await supabaseUserCtx.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  // Reject quarantined users at the Edge Function layer
  // (RLS on bounties already restricts their map view;
  //  this catches submission attempts on standard bounties too)
  const jwtPayload = await supabaseUserCtx.auth.getSession()
  const trustState = (jwtPayload.data.session?.access_token)
    ? JSON.parse(atob(jwtPayload.data.session.access_token.split('.')[1])).trust_state
    : null

  if (trustState === 'slashed') {
    return new Response(JSON.stringify({ error: 'trust_slashed' }), { status: 403 })
  }

  // INSERT submission — user_id auto-scoped by RLS to auth.uid()
  const { data: submission, error } = await supabaseUserCtx
    .from('critterverse.submissions')
    .insert({ bounty_id, submitted_lat: geo_lat, submitted_lng: geo_lng, user_id: user.id })
    .select()
    .single()

  if (error) return new Response(JSON.stringify({ error }), { status: 400 })

  // Pipeline event log — service_role (cross-user table write)
  await supabaseSvc
    .from('critterverse.pipeline_events')
    .insert({
      submission_id: submission.id,
      event_type:    'submission.initiated',
      event_data:    { bounty_id, geo_lat, geo_lng }
    })

  // Compute pedometer bounds — service_role
  const { data: bounty } = await supabaseSvc
    .from('critterverse.bounties')
    .select('geo_lat, geo_lng')
    .eq('id', bounty_id)
    .single()

  // ... pedometer bounds logic follows (unchanged from v0.2)

  return new Response(JSON.stringify({ submission_id: submission.id }), { status: 201 })
})
```

---

## Section 6: N-Hop CTE (Schema-Updated)

The voter selection CTE from v0.2 is unchanged in logic. All table references are updated to schema-qualified names:

```sql
-- Schema-qualified N-hop voter selection CTE
-- (logic identical to v0.2; only FROM clauses updated)

WITH RECURSIVE
trust_traversal AS (
  SELECT
    u.sunshade_node_hash  AS origin_hash,
    e.to_node_hash        AS neighbor_hash,
    1                     AS hop_count,
    ARRAY[u.sunshade_node_hash, e.to_node_hash] AS visited_path
  FROM  critterverse.users u
  JOIN  critterverse.sunshade_trust_edges e
        ON e.from_node_hash = u.sunshade_node_hash
  WHERE u.id = $1

  UNION ALL

  SELECT
    tt.origin_hash,
    e.to_node_hash,
    tt.hop_count + 1,
    tt.visited_path || e.to_node_hash
  FROM  trust_traversal tt
  JOIN  critterverse.sunshade_trust_edges e
        ON e.from_node_hash = tt.neighbor_hash
  WHERE tt.hop_count < 8
    AND NOT (e.to_node_hash = ANY(tt.visited_path))
),

proximate_nodes AS (
  SELECT DISTINCT neighbor_hash FROM trust_traversal WHERE hop_count <= $2
),

candidate_distances AS (
  SELECT neighbor_hash, MIN(hop_count) AS closest_hop
  FROM   trust_traversal
  WHERE  neighbor_hash NOT IN (SELECT neighbor_hash FROM proximate_nodes)
  GROUP  BY neighbor_hash
),

eligible_archivists AS (
  SELECT
    u.id, u.sunshade_node_hash, u.sunshade_path,
    u.trust_score, u.reputation_balance,
    cd.closest_hop                   AS hop_distance,
    FLOOR(cd.closest_hop / 2.0)::INT AS hop_tier
  FROM  candidate_distances cd
  JOIN  critterverse.users u ON u.sunshade_node_hash = cd.neighbor_hash
  WHERE u.trust_state        = 'active'
    AND u.archivist_eligible = TRUE
    AND u.trust_score        >= 0.70
    AND u.id                 != $1
    AND subpath(u.sunshade_path, 0, 2) != (
          SELECT subpath(s.sunshade_path, 0, 2)
          FROM   critterverse.users s WHERE s.id = $1
        )
    AND u.reputation_balance >= 10.0
),

ranked_archivists AS (
  SELECT *,
    ROW_NUMBER() OVER (
      ORDER BY hop_tier DESC, trust_score DESC, random()
    ) AS selection_rank
  FROM eligible_archivists
)

SELECT id, sunshade_node_hash, trust_score, hop_distance, selection_rank
FROM   ranked_archivists
WHERE  selection_rank <= 5
ORDER  BY selection_rank;
```

---

## Section 7: Revised Risk Matrix Additions (v0.3 Specific)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Native GoTrue auth provider left active | Low | Critical | Disable all providers in dashboard at project init; document as day-zero checklist item |
| JWT `sub` mismatch on bootstrap race condition | Low | High | Bootstrap endpoint is idempotent; UNIQUE constraint on `sunshade_node_hash` prevents duplicate users |
| `patchwork_bridge` schema accidentally exposed in PostgREST | Low | High | Exposure list is a single dashboard field; reviewed in weekly security audit |
| RLS disabled on a new table | Medium | High | Migration linter: every `CREATE TABLE critterverse.*` must be followed by `ENABLE ROW LEVEL SECURITY` |
| Edge Function uses service_role for user-scoped ops | Medium | Medium | Code review gate: service_role usage requires a comment block justifying the RLS bypass |
| `trust_state` in JWT stale after slashing event | Medium | Medium | Trust slash fires a SunShade webhook to invalidate the user's current JWT; user re-authenticates |
| Archivist peer view exposes full ltree path | Low | Medium | View exposes only `subpath(0,2)` — branch level, not leaf; full path not inferable |
| Bootstrap secret rotation breaks SunShade integration | Low | High | Secret rotated in both SunShade vault and Supabase simultaneously via coordinated deploy |

---

## Migration File Ordering (Phase 1)

```
migrations/
├── 001_schema_init.sql            -- CREATE SCHEMA; GRANT structure
├── 002_critterverse_core.sql      -- users, trust_events, bounties, submissions
├── 003_pipeline.sql               -- pipeline_events, anomalous_archive_queue, pedometer_bounds
├── 004_trust_graph.sql            -- sunshade_trust_edges, user_effective_trust view
├── 005_council.sql                -- council_sessions, council_voter_selection, council_votes
├── 006_bridge.sql                 -- patchwork_bridge.webhook_ingestion, outbound_pings
├── 007_cross_app.sql              -- cross_app_identity_links, cross_app_unlocks
├── 008_functions.sql              -- all critterverse.* functions
├── 009_rls.sql                    -- all RLS enables and policy definitions
└── 010_seed_alpha.sql             -- Phase 1 narrative seed data (alpha bounties, labels)
```

Each migration file begins with `SET search_path TO critterverse, patchwork_bridge, public;` to avoid unqualified object references within the file itself.

---

*Document version 0.3 — Critterverse Schema Namespacing + SunShade Auth Dominance.*
*Supersedes v0.2. Full change log in "What Changed from v0.2."*
*Classification: Internal Engineering.*
