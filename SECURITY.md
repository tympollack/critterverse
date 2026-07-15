# Critterverse Security Posture

This document describes the security architecture, boundary enforcement mechanisms, access control matrix, key rotation procedures, and known threat vectors for the Critterverse alpha build.

---

## 1. Schema Boundary Enforcement

The most critical security boundary in this system is the isolation of `patchwork_bridge` from client access. The enforcement is layered:

**Layer 1 — GRANT structure (001_schema_init.sql):**
The `USAGE` privilege on `patchwork_bridge` is granted only to `service_role`. The `authenticated` and `anon` roles receive no `USAGE` grant on the schema, making all objects in it invisible to them at the PostgreSQL level.

**Layer 2 — Explicit DML REVOKE (014_rls_addendum.sql):**
A `REVOKE SELECT, INSERT, UPDATE, DELETE` on all `patchwork_bridge` tables from `authenticated` and `anon` provides belt-and-suspenders protection against future migrations that might accidentally grant privileges.

**Layer 3 — RLS (not applicable):**
RLS is not enabled on `patchwork_bridge` tables because the GRANT layer blocks all access before RLS would evaluate. This is intentional — RLS on `patchwork_bridge` would create a false impression that access is governed by row-level policy when the correct answer is "no access at all."

**Layer 4 — PostgREST exposure:**
The `patchwork_bridge` schema does not appear in the Supabase API "Exposed Schemas" list. This means PostgREST does not generate any REST endpoints for bridge tables. Even a `service_role` key cannot reach bridge tables via the REST API — only via direct DB connection or Edge Functions using the service role client.

**Verification:**
```sql
-- Must return 0 rows
SELECT table_schema, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'patchwork_bridge'
  AND grantee IN ('authenticated', 'anon')
  AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');
```

---

## 2. Authentication Chain

```
SunShade Hub  →  (HS256 JWT)  →  Supabase GoTrue  →  RLS policies
```

- SunShade is the **sole Identity Provider**. GoTrue validates tokens but never issues them.
- JWT payload contract is strictly defined (see `docs/jwt-contract.md` note below).
- Native GoTrue auth providers (email, OAuth, etc.) **must remain disabled**. Leaving any enabled creates an authentication bypass.
- Token expiry: 60 minutes. Refresh is handled by the mobile client calling SunShade directly.
- `auth.uid()` in RLS policies resolves to `JWT.sub`, which is the Critterverse `users.id` UUID seeded by the bootstrap handshake.

**JWT custom claims used in RLS:**

| Claim | Type | Used in |
|---|---|---|
| `sub` | UUID | `auth.uid()` — all ownership checks |
| `sunshade_node_hash` | TEXT | `auth.jwt() ->> 'sunshade_node_hash'` — cross-app link |
| `sunshade_path` | TEXT | ltree operations in trust graph policies |
| `trust_state` | TEXT | Quarantine restriction on `bounties` SELECT |

**Stale JWT risk:**
The `trust_state` claim is cached in the JWT for its 60-minute lifetime. A trust slash applied during an active session won't be reflected until the next token. Mitigation: SunShade Hub fires a token invalidation webhook to Critterverse on slash events, and `trust/slash` updates the live DB state immediately. The client will receive a 403 on the next pipeline call.

---

## 3. Function EXECUTE Access Matrix

Migration `013_function_security.sql` enforces this matrix. The `DO $$` block at the end of that migration verifies the count at deploy time.

| Function | `authenticated` | `anon` | `service_role` |
|---|---|---|---|
| `haversine_km` | ✓ | — | ✓ |
| `sha256_hex` | ✓ | — | ✓ |
| `bounty_staleness_score` | ✓ | — | ✓ |
| `compute_pedometer_bounds` | ✓ | — | ✓ |
| `compute_pedometer_bounds_from_coords` | ✓ | — | ✓ |
| `get_bounty_indicators` | ✓ | ✓ | ✓ |
| `get_gopher_task` | ✓ | — | ✓ |
| `select_council_voters` | ✓ | — | ✓ |
| `verify_trust_chain` | ✓ | — | ✓ |
| `get_submission_pipeline_summary` | ✓ | — | ✓ |
| **`apply_trust_slash`** | **✗** | **✗** | ✓ |
| **`apply_trust_bonus`** | **✗** | **✗** | ✓ |
| **`credit_reputation`** | **✗** | **✗** | ✓ |
| **`resolve_council_session`** | **✗** | **✗** | ✓ |
| **`attempt_critter_drop`** | **✗** | **✗** | ✓ |

Any new function added to the `critterverse` schema defaults to **no EXECUTE for authenticated** (revoked by the blanket REVOKE in 013). Explicit grants must be added to `013_function_security.sql` and reviewed.

---

## 4. Edge Function Authentication Modes

Every Edge Function uses one of two explicit auth contexts. Using the wrong one for an operation is a security defect, not a style issue.

**User-JWT context** — forwards the caller's SunShade JWT, RLS enforced:
```typescript
const client = userClient(req)
```
Use for: reading own data, inserting own submissions.

**Service-role context** — bypasses RLS, requires manual authorization:
```typescript
const svc = serviceClient()
// COMMENT: RLS bypass justified — <reason>
```
Use for: trust slashing, balance updates, pipeline events, CRON operations, any cross-user reads.

**Internal-only functions** (CRON, pipeline triggers) use `X-Internal-Key`:
```typescript
if (!safeCompare(req.headers.get('X-Internal-Key') ?? '', INTERNAL_KEY)) {
  return 401
}
```
These functions must never accept user JWTs as their auth mechanism.

---

## 5. Trust Chain Integrity

The trust event chain is an append-only hash linked list:
```
current_hash = sha256(previous_hash || event_data::text)
```

**Append-only enforcement (two layers):**
1. PostgreSQL `CREATE RULE ... DO INSTEAD NOTHING` blocks UPDATE and DELETE at the rule level — no error is raised, the operation is silently discarded.
2. RLS policy `trust_events_no_client_write` blocks INSERT from authenticated clients — only `service_role` (via Edge Functions) can append events.

**Integrity verification:**
`critterverse.verify_trust_chain(user_id)` walks the entire chain and recomputes each hash. Called nightly by the health check's spot-check and available via `admin/pipeline-audit`.

**What the chain cannot prevent:**
A compromised `service_role` key can write arbitrary events. The chain provides cryptographic proof that *if* events were written by the legitimate system, they haven't been tampered with afterward. It is not a substitute for key security.

---

## 6. Webhook Security

**Inbound (PatchWork → Critterverse):**
- HMAC-SHA256 verification using `PATCHWORK_WEBHOOK_SECRET`
- Raw payload is logged **before** signature verification (to preserve the legal audit trail)
- Signature failure after logging → `translation_status = 'failed'`; no bounty created
- `patchwork_event_id` UNIQUE constraint prevents replay attacks

**Outbound (Critterverse → PatchWork):**
- HMAC-SHA256 signed with `CRITTERVERSE_OUTBOUND_SECRET`
- Payload is deliberately minimal: `{ patchwork_event_id, audit_confirmed_at, audit_source }`
- No game state, no user data, no reputation balances cross this boundary
- Fire-and-forget: outbound failure never blocks user rewards

---

## 7. Key Inventory and Rotation Schedule

| Secret | Rotation Frequency | Shared With | Impact If Compromised |
|---|---|---|---|
| `CRITTERVERSE_BOOTSTRAP_SECRET` | Quarterly | SunShade Hub only | New fake users could be registered |
| `TRUST_CHAIN_GENESIS_HASH` | **Never** | Public (well-known) | N/A — it's a constant |
| `INTERNAL_FUNCTION_KEY` | Quarterly | Internal only | CRON/pipeline functions could be invoked externally |
| `ZKP_PIPELINE_API_KEY` | Per ZKP team schedule | ZKP team | ZKP callbacks could be spoofed |
| `VISION_MODEL_API_KEY` | Annually | Vision model provider | Hashing could be manipulated |
| `PATCHWORK_WEBHOOK_SECRET` | Quarterly | PatchWork team | Fake bounties could be injected |
| `CRITTERVERSE_OUTBOUND_SECRET` | Quarterly | PatchWork team | Fake audit confirmations could be sent to PatchWork |
| `SUNSHADE_API_KEY` | Per SunShade schedule | SunShade team | Trust graph mirror could be corrupted |
| Supabase `JWT_SECRET` (HS256) | **Per SunShade key rotation** | SunShade Hub only | All active sessions immediately invalid |

**JWT Secret rotation procedure:**
1. SunShade Hub generates a new HS256 key
2. Coordinate: update `SUPABASE_JWT_SECRET` in Supabase Dashboard and SunShade's signing config simultaneously
3. All active JWTs are immediately invalidated; users re-authenticate on next request
4. No data migration required — JWTs are stateless

---

## 8. Threat Model Summary

| Threat | Vector | Mitigation |
|---|---|---|
| Fake submissions from slashed user | Direct API call with slashed JWT | `trust_state` claim in JWT → `trust/slash` emits SunShade invalidation; pipeline/initiate checks `trust_state` |
| Cross-user submission spoofing | `user_id` in POST body ≠ `auth.uid()` | RLS `WITH CHECK (user_id = auth.uid())` blocks the INSERT |
| Pedometer spoofing | Shake phone to inflate step count | Over-Achiever Trap: if `reported_steps > max_steps * 2`, mandatory penalty node assigned before reward |
| Image replay attack | Resubmit same photo at different location | Perceptual hash deduplication; cross-user duplicate → trust slash |
| Voter collusion in Council | Voters from same SunShade branch | N-hop CTE minimum hop threshold + ltree branch prefix separation |
| Commitment hash front-running | Read another voter's hash to copy their vote | Hashes are visible only AFTER `voting_deadline` (RLS policy on `council_votes`) |
| PatchWork webhook forgery | Send fake civic issue to inject bounties | HMAC-SHA256 verification; unsigned requests logged as failed but not processed |
| `patchwork_bridge` data exfiltration | Direct PostgREST API call | Schema not in exposed schemas list; GRANT structure blocks all DML |
| Trust chain tampering | Modify historical `trust_events` rows | `DO INSTEAD NOTHING` rule blocks UPDATE/DELETE; hash chain detects any tampering |
| Privilege escalation via SQL functions | Call `apply_trust_slash()` as `authenticated` | Migration 013 REVOKES EXECUTE on all privileged functions from `authenticated` |

---

## 9. Security Review Checklist (Before Each Deploy)

- [ ] `013_function_security.sql` verification query returns ≤ 9 grants for `authenticated`
- [ ] `014_rls_addendum.sql` verification query returns 0 DML grants to `authenticated`/`anon` on `patchwork_bridge`
- [ ] All native GoTrue auth providers are disabled in dashboard
- [ ] PostgREST exposed schemas is exactly `critterverse` (not `patchwork_bridge`, not `public`)
- [ ] `TRUST_CHAIN_GENESIS_HASH` is identical across all environments
- [ ] Health check returns `ok` after deploy (not `warn` or `error`)
- [ ] RLS test suite passes with 0 failures

---

*Critterverse Security Posture — Internal Engineering. Review quarterly or after any schema/auth change.*
