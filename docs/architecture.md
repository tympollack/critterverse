# Critterverse: System Architecture

This document describes the architectural decisions, component relationships, data flows, and design constraints that govern the Critterverse system. It is intended for engineers onboarding to the codebase and for architectural review.

---

## 1. System Overview

Critterverse is a gamified DePIN (Decentralized Physical Infrastructure Network) incentivising real-world cleanup through a variable-ratio reward system, cryptographic verification, and a decentralized peer-review consensus engine. It is built as an incentive layer on top of two existing systems:

- **PatchWork** — a civic infrastructure mapping tool with municipal partnerships
- **SunShade** — a privacy-first decentralized operating system providing Merkle DAG identity

```
┌──────────────────────────────────────────────────────────────────┐
│                        Mobile App                                │
│  (React Native — Survey Team deployment, Cavern Entrance map,   │
│   Relic Tribunal voting, Critter collection)                     │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTPS + SunShade JWT
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              Supabase (PostgreSQL + Edge Functions)              │
│  ┌────────────────────┐    ┌──────────────────────────────────┐  │
│  │  critterverse      │    │  patchwork_bridge                │  │
│  │  schema            │    │  schema (service_role only)      │  │
│  │                    │    │                                  │  │
│  │  users             │    │  webhook_ingestion               │  │
│  │  trust_events      │    │  outbound_pings                  │  │
│  │  bounties          │    └──────────────────────────────────┘  │
│  │  submissions       │                                          │
│  │  pipeline_events   │◀──── Edge Functions (28 total)           │
│  │  council_*         │      pipeline/, council/, trust/,        │
│  │  critter_species   │      bridge/, public/, user/, admin/,    │
│  │  ...               │      identity/, sync/                    │
│  └────────────────────┘                                          │
└───────────────┬──────────────────┬───────────────────────────────┘
                │                  │
                ▼                  ▼
       SunShade Merkle DAG    PatchWork API
       (Identity + Trust)     (One-way webhook
       (off-chain)             + public DID profile)
```

---

## 2. Schema Boundary

The most important architectural constraint is the hard separation between Critterverse game state and PatchWork civic data.

### Why this boundary exists

PatchWork is a civic tool with municipal partnerships. Its data is legally treated as infrastructure records. Critterverse uses tokenised rewards and staked reputation that may be subject to financial regulation. Commingling these in the same schema creates liability that could invalidate municipal contracts.

### How it is enforced (four layers)

| Layer | Mechanism |
|---|---|
| PostgreSQL GRANT | `USAGE` on `patchwork_bridge` granted to `service_role` only |
| Explicit REVOKE | Migration 014 revokes DML on all `patchwork_bridge` tables from `authenticated`/`anon` |
| PostgREST | `patchwork_bridge` is not in the exposed schemas list — no REST API surface |
| Soft references | `external_patchwork_ref UUID` columns have no `REFERENCES` constraint |

The data flow across this boundary is strictly one-way:

```
PatchWork → (webhook) → patchwork_bridge.webhook_ingestion (raw log)
                      → critterverse.bounties (translated, soft ref only)

Critterverse → (confirmation ping) → PatchWork audit endpoint
               (minimal payload: event_id + timestamp + source, no game state)
```

---

## 3. Authentication Chain

```
SunShade Hub  ──(HS256 JWT)──▶  Supabase GoTrue  ──▶  RLS policies
```

SunShade is the **sole Identity Provider**. GoTrue validates tokens but never issues them. All native GoTrue providers are disabled.

### JWT payload contract

```json
{
  "aud":               "authenticated",
  "iss":               "https://sunshade.network",
  "role":              "authenticated",
  "sub":               "<critterverse_users.id UUID>",
  "sunshade_node_hash": "<0xhex...>",
  "sunshade_path":     "<ltree path: root.branch_a.leaf_001>",
  "trust_state":       "active | quarantined | slashed",
  "iat":               1718036400,
  "exp":               1718040000
}
```

`auth.uid()` in Postgres resolves to `sub`. `auth.jwt()` exposes the full payload as JSONB, enabling RLS policies to read `sunshade_node_hash`, `sunshade_path`, and `trust_state` directly from the token without an additional DB lookup.

### User bootstrap handshake

The first time a SunShade DID is used with Critterverse, SunShade doesn't know the Critterverse UUID to embed in `sub`. The one-time bootstrap flow:

```
SunShade Hub  ──POST /identity/bootstrap──▶  Critterverse
              ←─ { critterverse_user_id }──
SunShade stores DID → UUID mapping in its own registry
SunShade mints JWT with sub = critterverse_user_id
All subsequent logins skip bootstrap
```

---

## 4. Trust Chain Design

Each user's trust history is an append-only hash-linked chain stored in `critterverse.trust_events`. The chain follows the structure used in blockchain systems: each event commits to the full prior state.

```
Event 1: genesis
  previous_hash = GENESIS_HASH (public constant)
  current_hash  = sha256(GENESIS_HASH || event_data)

Event 2: slashing
  previous_hash = Event1.current_hash
  current_hash  = sha256(Event1.current_hash || event_data)

Event N:
  previous_hash = Event(N-1).current_hash
  current_hash  = sha256(Event(N-1).current_hash || event_data)
```

**Append-only enforcement (two mechanisms):**
1. PostgreSQL rules (`DO INSTEAD NOTHING`) silently block `UPDATE` and `DELETE`
2. RLS policy `trust_events_no_client_write` blocks `INSERT` from `authenticated`

**Lazy quarantine:** Descendant nodes of a slashed user are quarantined *at runtime* via the `user_effective_trust` view. The `sunshade_path` ltree column enables ancestor queries using the `@>` operator and the GiST index. No descendant rows are modified — the quarantine is a read-time inference. This is the system's critical privacy-preserving design: users can verify their own path without being aware of which ancestor was compromised.

---

## 5. Ingestion Pipeline

Each submission follows a strict state machine enforced by both the `submissions.status` CHECK constraint and the `pipeline_events.event_type` CHECK constraint.

```
initiated
    │
    ├──▶ zkp_pending ──[ZKP valid]──▶ hashing
    │         │                          │
    │         └──[ZKP invalid]──▶ zkp_invalid (terminal)
    │                                    │
    │                         ┌──────────┴──────────┐
    │                         ▼                     ▼
    │                     verified              anomalous
    │               (confidence ≥ 0.75)    (confidence < 0.75)
    │                     │                      │
    │               storage.purged    storage.anomalous_archived
    │               (image deleted)       (image → Vault)
    │                                         │
    │                                 anomalous_archive_queue
    │                                         │
    │                                  council_sessions
    │                                  (N-hop voter selection)
    │
    └──▶ [offline] cached in Secure Enclave until reconnect
```

**Required pipeline events** (validated by `CHECK` constraint):
1. `submission.initiated`
2. `zkp.validation_started`
3. `zkp.status`
4. `hashing.processed`
5. `storage.purged` OR `storage.anomalous_archived` (exactly one)

**Duplicate detection:** Perceptual hash deduplication runs before AI classification. A cross-user pHash match triggers immediate rejection and a trust slash on the later submitter.

**Over-Achiever Trap:** If `reported_steps > max_steps_allowed × 2`, the submission is not immediately rejected but a penalty node is assigned. The user must complete a second verified cleanup at the penalty location before rewards from the current submission are released.

---

## 6. Scavenger Council (Consensus Engine)

Anomalous submissions trigger peer review by 5 veteran users (Archivists).

### N-hop voter selection

The N-hop CTE in `critterverse.select_council_voters()` performs a recursive graph traversal starting from the submitter's `sunshade_node_hash` in the local mirror of the SunShade trust graph.

```sql
WITH RECURSIVE trust_traversal AS (
  -- Anchor: immediate neighbors of the submitter
  -- Recursive: extend up to depth 8, with cycle guard
)
SELECT voters who are:
  - At least 3 hops away (configurable)
  - On a different ltree branch (subpath(0, 2) differs)
  - Trust score ≥ 0.70, archivist_eligible = TRUE
  - reputation_balance ≥ 10.0 (can stake)
```

The covering index `idx_ste_covering` on `sunshade_trust_edges (from_node_hash, to_node_hash)` is critical for this query's performance at scale.

### Blind voting (Schelling Point)

```
Phase 1 — Commit (48h window):
  voter computes: commitment = sha256(vote + ':' + random_salt)
  voter submits:  commitment_hash + stake_amount
  stake is locked from reputation_balance

Phase 2 — Reveal (24h window after commit deadline):
  voter submits:  vote (plaintext) + salt
  server verifies: sha256(vote + ':' + salt) == commitment_hash

Phase 3 — Resolution:
  majority verdict wins
  minority voters lose their full stake to majority pool
  majority voters receive proportional share of minority pool
  if verdict = 'fraudulent': submitter is trust-slashed
```

**Stake visibility:** RLS on `council_votes` hides other voters' commitments until `voting_deadline` passes. This prevents anchoring effects where later voters copy earlier ones.

---

## 7. Gamification Layer

### Variable Ratio Reward (Critter drops)

The Critter drop system uses a weighted random roll after every verified submission. The probability schedule follows a variable ratio reinforcement pattern — the most psychologically compelling reward schedule for behavior maintenance.

```sql
-- Weighted cumulative roll:
roll = random()  -- uniform [0, 1]
cumulative = SUM(drop_weight) over species ordered by drop_weight DESC
-- First species where cumulative >= roll wins
```

Drop weights by tier:
- Common:    ~73% total (4 species, 0.15–0.25 each)
- Uncommon:  ~18% total (3 species, 0.04–0.08 each)
- Rare:      ~3.8% total (3 species, 0.006–0.02 each)
- Legendary: ~0.2% total (2 species, 0.0005–0.0015 each)

### Mint provenance

Each minted Critter has a deterministic `mint_seed = sha256(submission_id + ':' + user_id)`. This enables on-chain provenance verification in Phase 4 without requiring the game server to be the source of truth for ownership.

---

## 8. PatchWork Bridge Design

The bridge is the narrowest possible data pipe between the two systems:

**Inbound (PatchWork → Critterverse):**
```
PatchWork webhook payload:
  { event_id, issue_type, coordinates, timestamp }
           │
           ├── HMAC-SHA256 verification
           ├── Raw payload logged to patchwork_bridge.webhook_ingestion (append-only)
           └── Translation via ISSUE_TYPE_MAP (TypeScript, not a shared DB table)
                       │
                       └── critterverse.bounties INSERT
                           (source='patchwork_webhook', external_patchwork_ref=event_id)
```

**Outbound (Critterverse → PatchWork):**
```
After verified civic_audit bounty:
  { patchwork_event_id, audit_confirmed_at, audit_source }
  (fire-and-forget; user reward issued before ping; outage cannot block rewards)
```

The `ISSUE_TYPE_MAP` is the only coupling point. If PatchWork changes its issue taxonomy, Critterverse updates one TypeScript object — there is no shared schema to migrate.

---

## 9. Edge Function Architecture

### Dual-context pattern

Every Edge Function uses one of two auth contexts:

**User-JWT context** — RLS enforced, operation scoped to caller:
```typescript
const client = userClient(req)  // forwards SunShade JWT
```

**Service-role context** — RLS bypassed, requires explicit justification:
```typescript
const svc = serviceClient()
// service_role: RLS bypass justified — <specific reason>
```

### Function namespaces

| Namespace | Purpose | Auth |
|---|---|---|
| `pipeline/` | Submission ingestion, ZKP, hashing | User-JWT + Internal |
| `council/` | Voter selection, blind voting, resolution | User-JWT + Internal |
| `trust/` | Slashing, quarantine, redemption | User-JWT + Internal |
| `bridge/` | PatchWork webhook bridge | HMAC + Internal |
| `identity/` | Bootstrap, cross-app link | Bootstrap secret + User-JWT |
| `user/` | Profile dashboard | User-JWT |
| `public/` | Unauthenticated read endpoints | None (rate limited) |
| `admin/` | Ops tooling, health, audit, analytics | Internal |
| `sync/` | CRON jobs: graph mirror, bounty maintenance | Internal (CRON) |

---

## 10. Phase Roadmap

### Phase 1 (Current): Subterranean Scavenger Alpha
- Full ingestion pipeline under narrative cover ("Survey Teams", "Cavern Entrances")
- ZKP geo-spatial validation
- N-hop voter selection + blind voting consensus engine
- Trust chain append-only ledger
- PatchWork bridge (inbound + outbound)
- SunShade SSO + cross-app identity

### Phase 2: Scavenger Council GA
- Mobile Council inbox (voter-status endpoint already deployed)
- Council acceptance, voting, reveal UX flows
- Notification system for Council deadlines
- Council verdict appeal mechanism

### Phase 3: Trust Ledger Public
- Redemption arc UX (Tier 1 decay progress, Tier 2 Gopher Task map)
- Quarantine visual effects (restricted bounty map)
- Trust score public profile (opt-in)

### Phase 3.5: Cross-Pollination Launch
- PatchWork easter egg badges (feature flag flip)
- SunShade SSO unlocks (Archivist status, Critter species)
- Legal review of outbound ping payload

### Phase 4: Full Critterverse GA
- Critter collection screen
- On-chain mint provenance (EVM or Solana — TBD)
- Variable ratio reward animation system
- Critter trading / transferability
- DePIN token economics (governance TBD)

---

## 11. Key Design Constraints (Non-Negotiable)

These constraints are enforced at the schema, function, and policy level and must not be relaxed without a formal architectural review:

1. **`patchwork_bridge` never exposed via PostgREST.** The exposed schemas setting must contain only `critterverse`.

2. **`external_patchwork_ref` never has a `REFERENCES` constraint.** The soft reference is advisory and intentionally unenforced.

3. **SunShade is the sole Identity Provider.** GoTrue native providers remain disabled. Any change requires SunShade Hub coordination and a session invalidation event.

4. **Trust events are append-only.** The `DO INSTEAD NOTHING` rule is the first line of defence. The RLS policy `trust_events_no_client_write` is the second.

5. **Privileged SQL functions are REVOKE'd from `authenticated`.** The function whitelist in `013_function_security.sql` has exactly 9 entries. Any addition requires an explicit migration and code review.

6. **Reward disbursement never depends on outbound ping success.** The `bridge/patchwork-outbound` function is fire-and-forget. PatchWork infrastructure outages cannot block Critterverse user rewards.

7. **The `TRUST_CHAIN_GENESIS_HASH` is a public constant and never changes.** It is `sha256('critterverse:genesis:v1')` and is the anchor for all trust chains across all environments.
