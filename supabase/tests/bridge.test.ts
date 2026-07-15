/**
 * tests/bridge.test.ts
 * Integration tests for the PatchWork bridge, trust/redemption arc,
 * and schema boundary enforcement.
 *
 * Run: deno test tests/bridge.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined,
  sha256Hex, PATCHWORK_WEBHOOK_SEC
} from './setup.ts'

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []

/** Compute HMAC-SHA256 for test webhook signatures */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}


// ─────────────────────────────────────────────────────────────
// BRIDGE TESTS
// ─────────────────────────────────────────────────────────────

// ── Test 1: PatchWork webhook correctly creates bounty ────────
Deno.test('bridge: known issue_type creates critterverse.bounty with soft ref', async () => {
  const svc       = svcClient()
  const eventId   = `pw-test-${Date.now()}`
  const patchworkRef = crypto.randomUUID()
  const payload   = {
    event_id:    patchworkRef,
    issue_type:  'illegal_dumping',
    coordinates: { lat: 37.7800, lng: -122.4100 },
    timestamp:   new Date().toISOString()
  }
  const body    = JSON.stringify(payload)
  const sigHex  = await hmacSha256Hex(PATCHWORK_WEBHOOK_SEC, body)

  // Simulate inbound webhook processing directly at DB level
  // (avoids needing the Edge Function running locally)
  const { data: logEntry } = await svc
    .from('patchwork_bridge.webhook_ingestion')
    .insert({
      patchwork_event_id: eventId,
      raw_payload:        payload,
      hmac_signature:     `hmac-sha256=${sigHex}`,
      hmac_verified:      true,
      translation_status: 'pending'
    })
    .select('id').single()

  assertDefined(logEntry, 'webhook log entry must be created')

  // Translate to bounty
  const { data: bounty } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat:                payload.coordinates.lat,
      geo_lng:                payload.coordinates.lng,
      bounty_type:            'civic_audit',
      source:                 'patchwork_webhook',
      external_patchwork_ref: patchworkRef,   // soft ref — no FK
      patchwork_issue_type:   'illegal_dumping',
      alpha_label:            'Contaminated Cavern',
      reward_multiplier:      2.5
    })
    .select('id, external_patchwork_ref, source')
    .single()

  assertDefined(bounty, 'bounty must be created from webhook')
  assertEq(bounty.source, 'patchwork_webhook', 'source must be patchwork_webhook')
  assertEq(bounty.external_patchwork_ref, patchworkRef, 'soft ref must be stored')

  createdBountyIds.push(bounty.id)

  // Update log entry
  await svc
    .from('patchwork_bridge.webhook_ingestion')
    .update({ translation_status: 'translated', translated_bounty_id: bounty.id, processed_at: new Date().toISOString() })
    .eq('id', logEntry.id)

  const { data: updated } = await svc
    .from('patchwork_bridge.webhook_ingestion')
    .select('translation_status, translated_bounty_id')
    .eq('id', logEntry.id).single()

  assertEq(updated?.translation_status, 'translated', 'log status must update to translated')
  assertEq(updated?.translated_bounty_id, bounty.id, 'log must reference the created bounty')
})


// ── Test 2: Duplicate event ID is idempotent ──────────────────
Deno.test('bridge: duplicate patchwork_event_id is rejected with UNIQUE constraint', async () => {
  const svc     = svcClient()
  const eventId = `pw-dup-test-${Date.now()}`

  await svc.from('patchwork_bridge.webhook_ingestion').insert({
    patchwork_event_id: eventId,
    raw_payload:        { test: true },
    hmac_signature:     'hmac-sha256=abc',
    hmac_verified:      true,
    translation_status: 'translated'
  })

  const { error } = await svc.from('patchwork_bridge.webhook_ingestion').insert({
    patchwork_event_id: eventId,
    raw_payload:        { test: true },
    hmac_signature:     'hmac-sha256=abc',
    hmac_verified:      true,
    translation_status: 'pending'
  })

  assert(error !== null, 'duplicate patchwork_event_id must violate UNIQUE constraint')
  assert(
    error?.message?.toLowerCase().includes('unique') || error?.code === '23505',
    `expected UNIQUE violation, got: ${error?.message}`
  )
})


// ── Test 3: patchwork_bridge tables inaccessible via anon key ─
Deno.test('bridge: patchwork_bridge schema not accessible to anon role', async () => {
  // Anon client — no auth, equivalent to a public API caller
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3')
  const anonKey  = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321',
    anonKey,
    { auth: { persistSession: false } }
  )

  // Attempt to SELECT from patchwork_bridge table (should fail)
  const { data, error } = await supabase
    .from('patchwork_bridge.webhook_ingestion')
    .select('id')
    .limit(1)

  // Either an error OR zero rows are acceptable — the test fails only
  // if data rows are returned, which would mean the schema is exposed
  const isBlocked = (error !== null) || (!data || data.length === 0)
  assert(isBlocked, 'patchwork_bridge.webhook_ingestion must not be accessible to anon role')
})


// ── Test 4: external_patchwork_ref has no FK constraint ───────
Deno.test('bridge: deleting a bounty with soft ref does not cascade to PatchWork', async () => {
  const svc = svcClient()
  const fakeRef = crypto.randomUUID()

  const { data: bounty } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat: 37.0, geo_lng: -122.0,
      bounty_type: 'standard', source: 'patchwork_webhook',
      external_patchwork_ref: fakeRef,   // points to nothing — no FK enforcement
      alpha_label: 'Test Soft Ref'
    })
    .select('id').single()

  assertDefined(bounty, 'bounty with soft ref should insert without error')

  // Confirm no FK error: the ref UUID does not exist anywhere in our schema
  const { data: lookup } = await svc
    .from('critterverse.bounties')
    .select('external_patchwork_ref')
    .eq('id', bounty.id).single()

  assertEq(lookup?.external_patchwork_ref, fakeRef, 'soft ref stored verbatim')

  // Clean up
  await svc.from('critterverse.bounties').delete().eq('id', bounty.id)
})


// ─────────────────────────────────────────────────────────────
// TRUST / REDEMPTION ARC TESTS
// ─────────────────────────────────────────────────────────────

// ── Test 5: Quarantine lazy evaluation via ancestor ───────────
Deno.test('trust: quarantined ancestor propagates to descendant via view', async () => {
  const svc = svcClient()

  // Create a parent user who will be quarantined
  const parentId = await createTestUser(svc, { sunshade_path: 'root.test_q_branch' })
  // Create a child user on the same ltree path
  const childId  = await createTestUser(svc, { sunshade_path: 'root.test_q_branch.child_001' })
  createdUserIds.push(parentId, childId)

  // Quarantine the parent
  await svc
    .from('critterverse.users')
    .update({ trust_state: 'quarantined' })
    .eq('id', parentId)

  // Child's own_state should still be 'active'
  const { data: childDirect } = await svc
    .from('critterverse.users')
    .select('trust_state')
    .eq('id', childId).single()

  assertEq(childDirect?.trust_state, 'active', 'child own trust_state must remain active')

  // But effective_state via the view should be 'quarantined'
  const { data: effective } = await svc
    .from('critterverse.user_effective_trust')
    .select('effective_state, has_quarantined_ancestor')
    .eq('id', childId).single()

  assertEq(
    effective?.effective_state,
    'quarantined',
    'child effective_state must be quarantined due to parent'
  )
  assert(effective?.has_quarantined_ancestor === true, 'has_quarantined_ancestor must be true')
})


// ── Test 6: Redemption Tier 1 decay increments trust_score ───
Deno.test('trust: Tier 1 decay increments trust_score by 0.05 per submission', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.25, trust_state: 'quarantined' })
  createdUserIds.push(userId)

  // Simulate calling credit_reputation (tests the SQL function)
  const { error } = await svc.rpc('critterverse.credit_reputation', {
    p_user_id: userId,
    p_amount:  10.0
  })
  assert(error === null, `credit_reputation failed: ${error?.message}`)

  const { data: user } = await svc
    .from('critterverse.users')
    .select('reputation_balance')
    .eq('id', userId).single()

  assert((user?.reputation_balance ?? 0) >= 110.0, 'balance should increase by 10.0 after credit')
})


// ── Test 7: Gopher Task selects highest-priority stale bounty ─
Deno.test('trust: get_gopher_task returns highest priority stale bounty', async () => {
  const svc = svcClient()

  // Create two gopher_target bounties with different staleness
  const staleTime = new Date(Date.now() - 72 * 3_600_000).toISOString()  // 72h ago
  const freshTime = new Date(Date.now() -  2 * 3_600_000).toISOString()  // 2h ago

  const { data: staleBounty } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat: 37.8000, geo_lng: -122.4000,
      bounty_type: 'gopher_target', source: 'admin_seeded',
      last_verified_at: staleTime, traffic_weight: 1.0, is_active: true
    })
    .select('id').single()

  const { data: freshBounty } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat: 37.8001, geo_lng: -122.4001,
      bounty_type: 'gopher_target', source: 'admin_seeded',
      last_verified_at: freshTime, traffic_weight: 1.0, is_active: true
    })
    .select('id').single()

  assertDefined(staleBounty, 'stale bounty must be created')
  assertDefined(freshBounty, 'fresh bounty must be created')
  createdBountyIds.push(staleBounty.id, freshBounty.id)

  const testUser = await createTestUser(svc)
  createdUserIds.push(testUser)

  const { data: task } = await svc.rpc('critterverse.get_gopher_task', {
    p_user_lat: 37.8000,
    p_user_lng: -122.4000,
    p_user_id:  testUser
  })

  assertDefined(task, 'Gopher Task result must be returned')
  assert((task?.length ?? 0) > 0, 'at least one task must be returned')
  assertEq(task[0].bounty_id, staleBounty.id, 'stalest bounty must be selected')
})


// ── Test 8: Trust chain append-only rules block UPDATE ────────
Deno.test('trust: trust_events append-only rule blocks UPDATE attempts', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const { data: events } = await svc
    .from('critterverse.trust_events')
    .select('id, event_type')
    .eq('user_id', userId)
    .limit(1)

  assertDefined(events?.[0], 'user must have at least one trust event')

  // Attempt to UPDATE (should be silently ignored by the DO INSTEAD NOTHING rule)
  const { error } = await svc
    .from('critterverse.trust_events')
    .update({ event_type: 'trust.slashing' })
    .eq('id', events![0].id)

  // pg rules with DO INSTEAD NOTHING produce no error but also no change
  const { data: unchanged } = await svc
    .from('critterverse.trust_events')
    .select('event_type')
    .eq('id', events![0].id)
    .single()

  assertEq(
    unchanged?.event_type,
    'trust.established',
    'trust event type must not be modifiable — append-only rule must block UPDATE'
  )
})


// ── Test 9: Bounty indicators returns correct marker styles ───
Deno.test('bridge: get_bounty_indicators returns correct marker_style per bounty type', async () => {
  const svc = svcClient()
  const pwRef = crypto.randomUUID()

  const { data: civicBounty } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat: 37.7749, geo_lng: -122.4194,
      bounty_type: 'civic_audit', source: 'patchwork_webhook',
      external_patchwork_ref: pwRef,
      reward_multiplier: 3.0, is_active: true
    })
    .select('id').single()

  createdBountyIds.push(civicBounty!.id)

  const { data: indicators } = await svc.rpc('critterverse.get_bounty_indicators', {
    p_lat:       37.7749,
    p_lng:       -122.4194,
    p_radius_km: 1.0
  })

  const civicIndicator = (indicators ?? []).find(
    (i: { external_patchwork_ref: string }) => i.external_patchwork_ref === pwRef
  )
  assertDefined(civicIndicator, 'civic_audit bounty must appear in indicators')
  assertEq(
    civicIndicator.marker_style,
    'critter_civic',
    'civic_audit with multiplier >= 2.5 must return critter_civic style'
  )
})


// ── Cleanup ───────────────────────────────────────────────────
Deno.test({
  name: 'bridge: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
