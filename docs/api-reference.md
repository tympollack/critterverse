# Critterverse API Reference

All Edge Functions are served at:
```
https://<project-ref>.supabase.co/functions/v1/<function-path>
```

---

## Authentication

### Authenticated Endpoints
Pass the SunShade-minted JWT in the `Authorization` header:
```
Authorization: Bearer <sunshade-jwt>
```

### Internal Endpoints
Pass the shared internal key:
```
X-Internal-Key: <INTERNAL_FUNCTION_KEY>
```

### Public Endpoints
No authentication required (rate limited at the Supabase edge).

---

## Public Endpoints

### `GET /public/bounty-indicators`
Returns sparse geographic marker hints for PatchWork's easter egg UI.
No authentication required. Response cached for 2 minutes.

**Query params:**
| Param | Type | Default | Max |
|---|---|---|---|
| `lat` | float | required | — |
| `lng` | float | required | — |
| `radius_km` | float | `2.0` | `5.0` |

**Response 200:**
```json
{
  "indicators": [
    {
      "external_patchwork_ref": "uuid",
      "marker_style": "critter_active | critter_rare | critter_civic"
    }
  ]
}
```

---

## Pipeline

### `POST /pipeline/initiate`
Creates a submission, computes pedometer bounds, and fires the ZKP pipeline.

**Auth:** SunShade JWT

**Body:**
```json
{
  "bounty_id":              "uuid",
  "submitted_lat":          37.7749,
  "submitted_lng":          -122.4194,
  "start_lat":              37.7700,
  "start_lng":              -122.4180,
  "reported_steps":         720,
  "is_offline_submission":  false,
  "offline_sequence_hash":  null,
  "exif_lat":               37.7749,
  "exif_lng":               -122.4194,
  "exif_timestamp":         "2024-01-15T10:30:00Z"
}
```

**Response 201:**
```json
{
  "submission_id":          "uuid",
  "is_offline":             false,
  "is_over_achiever_trap":  false,
  "trap_penalty_bounty_id": null,
  "pedometer": {
    "expected_steps":       720,
    "min_steps":            576,
    "max_steps":            864
  },
  "narrative": {
    "event":   "survey_team_deployed",
    "message": "Survey Team dispatched to Cavern Entrance."
  }
}
```

**Errors:**
- `403 trust_slashed` — user's Survey Team has been disbanded
- `404 bounty_not_found`
- `409 bounty_inactive`

---

### `POST /pipeline/offline-sync`
Processes queued offline submissions when the user reconnects. The "Encrypted Cache hatching" moment.

**Auth:** SunShade JWT

**Body:**
```json
{
  "submission_id":          "uuid",
  "sequence_photo_hashes":  ["hash1", "hash2", "hash3"],
  "exif_lat":               37.7749,
  "exif_lng":               -122.4194,
  "exif_timestamp":         "2024-01-15T10:30:00Z"
}
```

**Response 200:**
```json
{
  "status":    "sync_complete",
  "total":     1,
  "synced":    1,
  "rejected":  0,
  "results":   { "uuid": "synced:zkp_pending" },
  "narrative": "1 Encrypted Cache hatching — your Survey Team's findings are being authenticated."
}
```

---

### `GET /public/submission-status`
Polls the pipeline state for a submission. Returns narrative copy for each stage.

**Auth:** SunShade JWT

**Query params:**
| Param | Type | Required |
|---|---|---|
| `submission_id` | uuid | yes |

**Response 200:**
```json
{
  "submission_id":   "uuid",
  "status":          "verified",
  "progress_pct":    100,
  "narrative": {
    "title": "Cavern Entrance Logged",
    "body":  "Your Survey Team's report has been confirmed and filed. Rewards have been credited."
  },
  "bounty": {
    "id":           "uuid",
    "alpha_label":  "Cavern Entrance #001",
    "bounty_type":  "standard"
  },
  "pipeline_events": [
    { "event_seq": 1, "event_type": "submission.initiated", "occurred_at": "..." },
    { "event_seq": 2, "event_type": "zkp.validation_started", "occurred_at": "..." },
    { "event_seq": 3, "event_type": "zkp.status", "occurred_at": "..." },
    { "event_seq": 4, "event_type": "hashing.processed", "occurred_at": "..." },
    { "event_seq": 5, "event_type": "storage.purged", "occurred_at": "..." }
  ],
  "pedometer":         { ... },
  "over_achiever_trap": null,
  "council":           null,
  "reward": {
    "multiplier": 1.0,
    "amount":     10.0,
    "paid_at":    "2024-01-15T10:32:00Z"
  },
  "critter_drop": {
    "species_name": "Corewatcher",
    "rarity_tier":  "uncommon",
    "minted_at":    "2024-01-15T10:32:01Z"
  }
}
```

**Errors:**
- `404` — submission not found or belongs to a different user (RLS filters silently)

---

## User

### `GET /user/profile`
Full dashboard data for the authenticated user. Call on app load and after any state change.

**Auth:** SunShade JWT

**Response 200:**
```json
{
  "user_id":            "uuid",
  "sunshade_node_hash": "0xabc...",
  "member_since":       "2024-01-01T00:00:00Z",
  "trust": {
    "score":                    0.90,
    "state":                    "active",
    "effective_state":          "active",
    "has_quarantined_ancestor": false
  },
  "reputation_balance":  150.0,
  "archivist_eligible":  true,
  "submissions": {
    "total":              42,
    "verified":           38,
    "rejected":           2,
    "anomalous":          1,
    "pending":            1,
    "total_reward_earned": 380.0
  },
  "council": {
    "total_invitations":    5,
    "accepted_invitations": 4,
    "pending_invitations":  0,
    "completed_sessions":   3,
    "majority_verdicts":    3,
    "pending_actions":      0
  },
  "critters": {
    "total_collected": 12,
    "recent": [
      { "species_name": "Vaultkeeper", "rarity_tier": "rare" }
    ]
  },
  "redemption": null,
  "cross_app": {
    "patchwork_linked": true,
    "accuracy_tier":    "gold",
    "last_synced":      "2024-01-15T00:00:00Z",
    "unlocks": [
      { "type": "archivist_status", "granted_at": "2024-01-01T10:00:00Z" }
    ]
  },
  "narrative": {
    "status_title": "Survey Team Active",
    "status_body":  "Your Survey Team roams freely. Deploy them to discover new Cavern Entrances."
  }
}
```

**Redemption block when quarantined (Tier 1):**
```json
{
  "redemption": {
    "tier":                          "1",
    "description":                   "Complete verified cleanups at reduced reward to decay quarantine.",
    "decay_verifications_remaining": 6,
    "progress_pct":                  40,
    "current_score":                 0.37,
    "active_threshold":              0.55,
    "reward_multiplier":             0.1
  }
}
```

**Redemption block when slashed (Tier 2):**
```json
{
  "redemption": {
    "tier":         "2",
    "description":  "Gopher Task required before decay can begin.",
    "next_action":  "complete_gopher_task",
    "current_score": 0.08
  }
}
```

---

## Identity

### `POST /identity/bootstrap`
**Internal only** — called by SunShade Hub. Creates a Critterverse user for a new DID.

**Auth:** `Authorization: Bearer <CRITTERVERSE_BOOTSTRAP_SECRET>`

**Body:** `{ "sunshade_node_hash": "0x...", "sunshade_path": "root.branch_a.leaf_001" }`

**Response 201/200:**
```json
{ "critterverse_user_id": "uuid", "bootstrapped": true }
```

---

### `POST /identity/cross-app-link`
Links a user's SunShade DID to their PatchWork accuracy tier and grants unlocks.

**Auth:** SunShade JWT

**Response 200:**
```json
{
  "linked":          true,
  "accuracy_tier":   "gold",
  "unlocks_granted": ["archivist_status"],
  "is_new_link":     true
}
```

---

## Council

### `POST /council/accept`
Accept or decline a Council invitation.

**Auth:** SunShade JWT

**Body:** `{ "session_id": "uuid", "action": "accept" }`

**Response 200:**
```json
{
  "status":          "accepted",
  "session_id":      "uuid",
  "accepted_count":  5,
  "session_ready":   true,
  "voting_deadline": "2024-01-17T10:30:00Z",
  "archive_item": {
    "confidence_band": "low",
    "classification":  "unknown_debris"
  },
  "narrative": "The Relic Tribunal is assembled. Cast your verdict before the deadline."
}
```

---

### `POST /council/vote`
Submit a blind commitment hash + stake for a Council session.

**Auth:** SunShade JWT

**Body:**
```json
{
  "session_id":       "uuid",
  "commitment_hash":  "sha256(\"legitimate:mysalt\")",
  "stake_amount":     20.0
}
```
Compute locally: `sha256(vote_value + ':' + random_salt)` where `vote_value` is `"legitimate"` or `"fraudulent"`.

**Response 201:**
```json
{
  "status":          "committed",
  "session_id":      "uuid",
  "stake_locked":    20.0,
  "voting_deadline": "2024-01-17T10:30:00Z",
  "message":         "Your verdict has been sealed. Reveal it when the Tribunal reconvenes."
}
```

**Errors:**
- `403 not_an_accepted_voter`
- `409 session_not_active`, `voting_deadline_passed`, `already_voted`
- `400 stake_below_minimum`, `stake_exceeds_maximum`, `insufficient_balance`

---

### `POST /council/reveal`
Reveal the plaintext vote and salt after the voting deadline.

**Auth:** SunShade JWT

**Body:**
```json
{
  "session_id": "uuid",
  "vote":       "legitimate",
  "salt":       "mysalt"
}
```

**Response 200:**
```json
{
  "status":          "reveal_accepted",
  "vote":            "legitimate",
  "reveal_deadline": "2024-01-18T10:30:00Z"
}
```

**Errors:**
- `409 voting_still_open` — deadline has not passed yet
- `409 reveal_deadline_passed`
- `422 reveal_invalid` — commitment hash mismatch; vote is invalid

---

### `GET /council/voter-status`
Returns all council sessions the authenticated user is involved in, with the next required action.

**Auth:** SunShade JWT

**Response 200:**
```json
{
  "sessions": [
    {
      "session_id":        "uuid",
      "session_status":    "active",
      "invitation_status": "accepted",
      "action_required":   "cast_vote",
      "action_deadline":   "2024-01-17T10:30:00Z",
      "has_committed":     false,
      "has_revealed":      false,
      "stake_amount":      null,
      "consensus_result":  null,
      "confidence_band":   "low",
      "ai_classification": "unknown_debris",
      "voting_deadline":   "2024-01-17T10:30:00Z",
      "narrative":         "The Tribunal awaits your sealed verdict. Cast your vote before the deadline."
    }
  ],
  "pending_action_count": 1,
  "total_sessions":       3
}
```

`action_required` values: `accept_or_decline` | `cast_vote` | `reveal_vote` | `null` (no action needed)

---

## Trust

### `GET /trust/quarantine`
Returns the effective trust state for the calling user (lazy quarantine evaluation).

**Auth:** SunShade JWT | `?user_id=<uuid>` (admin use)

**Response 200:**
```json
{
  "user_id":                  "uuid",
  "effective_state":          "quarantined",
  "own_state":                "active",
  "trust_score":              0.45,
  "has_quarantined_ancestor": true,
  "redemption_tier":          "tier1_decay",
  "narrative":                "Your Cavern Access has been restricted. Complete baseline verifications to decay your quarantine."
}
```

---

### `POST /trust/redemption-t2`
Assign or complete a Gopher Task for Redemption Tier 2.

**Auth:** SunShade JWT (slashed users only)

**Assign:**
```json
{ "action": "assign", "user_lat": 37.7749, "user_lng": -122.4194 }
```

**Complete:**
```json
{ "action": "complete", "submission_id": "uuid" }
```

**Response 200 (assign):**
```json
{
  "status":      "assigned",
  "bounty_id":   "uuid",
  "geo_lat":     37.7800,
  "geo_lng":     -122.4100,
  "alpha_label": "Stale Survey Point Alpha",
  "priority":    48.3,
  "narrative":   "A stale Uncharted Passage awaits your Survey Team. Complete a verified cleanup to earn your redemption."
}
```

**Response 200 (complete):**
```json
{
  "status":      "tier2_complete",
  "trust_state": "quarantined",
  "trust_score": 0.20,
  "narrative":   "The Uncharted Passage has been cleared. Your Survey Team may now begin the long road back through Tier 1 recovery."
}
```

---

## Bridge (Internal)

### `POST /bridge/patchwork-inbound`
Receive and translate a PatchWork webhook into a Critterverse bounty.

**Auth:** `X-PatchWork-Sig: hmac-sha256=<signature>` (verified against `PATCHWORK_WEBHOOK_SECRET`)

**Headers:**
- `X-PatchWork-Sig: hmac-sha256=<hex>`
- `X-PatchWork-Event-Id: <event-uuid>`

**Body (from PatchWork):**
```json
{
  "event_id":    "uuid",
  "issue_type":  "illegal_dumping",
  "coordinates": { "lat": 37.7749, "lng": -122.4194 },
  "timestamp":   "2024-01-15T10:00:00Z"
}
```

**Supported `issue_type` values:** `illegal_dumping`, `fly_tipping`, `hazardous_waste`, `abandoned_vehicle`, `graffiti`, `broken_infrastructure`, `litter_hotspot`, `dumped_appliances`

**Response 201:** `{ "status": "translated", "bounty_id": "uuid" }`

**Response 200:** `{ "status": "ignored" }` (unmapped issue type) or `{ "status": "duplicate" }` (idempotent replay)

---

## Admin

### `GET /admin/health-check`
System-wide health probe. Used by deploy pipelines and on-call tooling.

**Auth:** `X-Internal-Key`

**Response 200/503:**
```json
{
  "overall":     "ok | warn | error",
  "checked_at":  "2024-01-15T10:00:00Z",
  "elapsed_ms":  142,
  "checks": {
    "db_connectivity":         { "status": "ok",   "value": { "user_count": 42 }, "message": "..." },
    "bridge_backlog":          { "status": "ok",   "value": { "pending_count": 0 }, "message": "..." },
    "outbound_pings":          { "status": "ok",   "value": { "exhausted_count": 0 }, "message": "..." },
    "anomalous_queue":         { "status": "warn", "value": { "total_pending": 6, "critical_pending": 2 }, "message": "..." },
    "council_sessions":        { "status": "ok",   "value": { "stale_past_deadline": 0 }, "message": "..." },
    "trust_chain_integrity":   { "status": "ok",   "value": { "sample_size": 10, "broken": 0 }, "message": "..." },
    "sunshade_mirror":         { "status": "ok",   "value": { "hours_ago": "14.2" }, "message": "..." }
  }
}
```

Returns `503` when `overall = "error"`.

---

### `GET /admin/pipeline-audit`
Full audit trail for a single submission.

**Auth:** `X-Internal-Key`

**Query params:**
| Param | Type | Required |
|---|---|---|
| `submission_id` | uuid | yes |
| `verify_chain` | bool | no (default false) |

**Response 200:** Full submission object with pipeline events, pedometer bounds, anomalous archive item, council session and votes (post-deadline), trust integrity result (if `verify_chain=true`).

---

### `GET /admin/user-report`
Full audit report for a specific user.

**Auth:** `X-Internal-Key`

**Query params:**
| Param | Type | Default |
|---|---|---|
| `user_id` | uuid | required |
| `verify_chain` | bool | `false` |
| `include_votes` | bool | `true` |

**Response 200:** User identity, trust chain (last 50 events), risk flags, submissions (last 20 with pipeline events), council involvement, pedometer trap history, cross-app data. Risk flags: `NO_FLAGS`, `TRUST_SLASHED`, `QUARANTINED_ANCESTOR`, `BROKEN_TRUST_CHAIN`, `OVER_ACHIEVER_TRAP_TRIGGERED`, `MULTIPLE_REJECTIONS_N`, `MULTIPLE_ANOMALOUS_N`.

---

## Analytics Views (service_role DB queries only)

| View | Description |
|---|---|
| `critterverse.v_daily_submission_stats` | Daily pipeline throughput and verification rate |
| `critterverse.v_trust_distribution` | Population histogram of trust score bands |
| `critterverse.v_council_verdict_summary` | Weekly council verdict rates and stake flows |
| `critterverse.v_bounty_verification_heatmap` | Per-bounty activity and staleness |
| `critterverse.v_archivist_leaderboard` | Archivist engagement and majority rates |
| `critterverse.v_anomalous_queue_status` | Real-time queue health by confidence band |
| `critterverse.v_redemption_arc_funnel` | Trust funnel: active → quarantined → slashed |
| `critterverse.v_patchwork_bridge_activity` | Bridge pipeline health and ping delivery |

---

## CRON Endpoints (triggered by pg_cron, not for direct use)

| Endpoint | Schedule | Description |
|---|---|---|
| `POST /council/resolve` | `*/30 * * * *` | Resolve sessions past their reveal deadline |
| `POST /bridge/retry-pings` | `*/15 * * * *` | Retry failed outbound PatchWork pings (max 3) |
| `POST /sync/sunshade-mirror` | `0 0 * * *` | Nightly SunShade trust graph delta sync |
| `POST /sync/bounty-maintenance` | `0 */6 * * *` | Bounty hygiene, council queue, under-quorum re-invite |

---

## Alpha Narrative Glossary

| Technical term | Alpha narrative label |
|---|---|
| Submission | Survey Team deployment |
| Bounty | Cavern Entrance |
| Anomalous submission | Unidentified Artifact |
| ZKP validation | Location Seal / Authentication Scan |
| Offline submission | Encrypted Cache |
| Offline sync | Cache hatching |
| Scavenger Council | Relic Tribunal |
| Council voter (Archivist) | Elder Scavenger |
| Trust slashing | Cavern Collapse |
| Quarantine | Cavern Access Restricted |
| Gopher Task (Redemption T2) | Uncharted Passage |
| Critter drop | Species discovery |
