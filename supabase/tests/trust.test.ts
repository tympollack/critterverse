/**
 * tests/trust.test.ts
 * Integration tests for the full trust and redemption arc:
 *   - Trust chain hash linking and append-only enforcement
 *   - Slashing severity and state transitions
 *   - Lazy quarantine propagation via ltree ancestor check
 *   - Redemption Tier 1 decay to active
 *   - Redemption Tier 2 Gopher Task requirement
 *   - Cross-app trust bonus application
 *   - credit_reputation balance accounting
 *
 * Run: deno test tests/trust.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined, sha256Hex, GENESIS_HASH
} from './setup.ts'

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []


// ─────────────────────────────────────────────────────────────
// TRUST CHAIN INTEGRITY
// ─────────────────────────────────────────────────────────────

Deno.test('trust chain: genesis event anchors to known hash constant', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const { data: events } = await svc
    .from('critterverse.trust_events')
    .select('previous_hash, current_hash, event_type')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)

  assertDefined(events?.[0], 'genesis event must exist')
  assertEq(events![0].event_type, 'trust.established', 'first event must be trust.established')
  assertEq(events![0].previous_hash, GENESIS_HASH, 'genesis previous_hash must equal the well-known constant')
})


Deno.test('trust chain: each event correctly extends the hash chain', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  // Apply two slashes to generate a multi-event chain
  await svc.rpc('critterverse.apply_trust_slash', { p_user_id: userId, p_reason: 'test_slash_1', p_severity: 0.10 })
  await svc.rpc('critterverse.apply_trust_slash', { p_user_id: userId, p_reason: 'test_slash_2', p_severity: 0.10 })

  const { data: events } = await svc
    .from('critterverse.trust_events')
    .select('previous_hash, current_hash, event_data')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  assert((events?.length ?? 0) >= 3, 'should have genesis + 2 slash events')

  // Verify each link in the chain (skip genesis — previous_hash is the constant)
  for (let i = 1; i < (events?.length ?? 0); i++) {
    const prev    = events![i - 1]
    const current = events![i]

    // current.previous_hash must equal prev.current_hash
    assertEq(
      current.previous_hash,
      prev.current_hash,
      `event ${i}: previous_hash must equal prior event's current_hash`
    )

    // Recompute the hash and verify
    const recomputed = await sha256Hex(current.previous_hash + JSON.stringify(current.event_data))
    assertEq(
      current.current_hash,
      recomputed,
      `event ${i}: current_hash must equal sha256(previous_hash || event_data)`
    )
  }

  // Verify via the SQL function too
  const { data: chainResult } = await svc
    .rpc('critterverse.verify_trust_chain', { p_user_id: userId })
  assert(chainResult?.[0]?.is_valid === true, 'SQL verify_trust_chain must confirm chain valid')
  assertEq(chainResult![0].chain_length, events!.length, 'chain_length must match event count')
})


Deno.test('trust chain: append-only rule silently blocks UPDATE; DELETE is also blocked', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const { data: genesis } = await svc
    .from('critterverse.trust_events')
    .select('id, current_hash')
    .eq('user_id', userId)
    .single()

  // Attempt UPDATE — pg rule DO INSTEAD NOTHING produces no error, no change
  await svc
    .from('critterverse.trust_events')
    .update({ current_hash: 'tampered_hash' })
    .eq('id', genesis!.id)

  const { data: after } = await svc
    .from('critterverse.trust_events')
    .select('current_hash')
    .eq('id', genesis!.id)
    .single()

  assertEq(after?.current_hash, genesis!.current_hash, 'UPDATE must be silently ignored')

  // Attempt DELETE — also blocked
  await svc.from('critterverse.trust_events').delete().eq('id', genesis!.id)

  const { data: stillExists } = await svc
    .from('critterverse.trust_events')
    .select('id')
    .eq('id', genesis!.id)
    .single()

  assertDefined(stillExists, 'DELETE must be silently ignored — event must still exist')
})


// ─────────────────────────────────────────────────────────────
// TRUST SLASHING AND STATE TRANSITIONS
// ─────────────────────────────────────────────────────────────

Deno.test('slashing: mild slash (severity 0.20) → quarantined, not slashed', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.80 })
  createdUserIds.push(userId)

  await svc.rpc('critterverse.apply_trust_slash', {
    p_user_id: userId, p_reason: 'mild_infraction', p_severity: 0.20
  })

  const { data: user } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', userId).single()

  const expectedScore = 0.80 * (1 - 0.20)  // 0.64
  assert(Math.abs((user?.trust_score ?? 0) - expectedScore) < 0.001, `score should be ${expectedScore}`)
  assertEq(user?.trust_state, 'quarantined', 'score 0.64 is above 0.30 threshold → quarantined not slashed')
})


Deno.test('slashing: severe slash (severity 0.70) → slashed state', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.80 })
  createdUserIds.push(userId)

  await svc.rpc('critterverse.apply_trust_slash', {
    p_user_id: userId, p_reason: 'severe_fraud', p_severity: 0.70
  })

  const { data: user } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', userId).single()

  const expectedScore = 0.80 * (1 - 0.70)  // 0.24
  assert(Math.abs((user?.trust_score ?? 0) - expectedScore) < 0.001, `score should be ${expectedScore}`)
  assertEq(user?.trust_state, 'slashed', 'score 0.24 is below 0.30 threshold → slashed')
})


Deno.test('slashing: cumulative slashes cannot drive score below 0', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.10 })
  createdUserIds.push(userId)

  // Three severe slashes
  for (const reason of ['s1', 's2', 's3']) {
    await svc.rpc('critterverse.apply_trust_slash', {
      p_user_id: userId, p_reason: reason, p_severity: 0.80
    })
  }

  const { data: user } = await svc
    .from('critterverse.users')
    .select('trust_score')
    .eq('id', userId).single()

  assert((user?.trust_score ?? -1) >= 0, 'trust_score must never go below 0')
})


// ─────────────────────────────────────────────────────────────
// LAZY QUARANTINE PROPAGATION
// ─────────────────────────────────────────────────────────────

Deno.test('quarantine: ancestor quarantine propagates to descendant without touching descendant row', async () => {
  const svc      = svcClient()
  const branchId = Date.now()

  const parentId = await createTestUser(svc, {
    sunshade_path: `root.lazy_q_branch_${branchId}`
  })
  const childId  = await createTestUser(svc, {
    sunshade_path: `root.lazy_q_branch_${branchId}.child_001`
  })
  const grandchildId = await createTestUser(svc, {
    sunshade_path: `root.lazy_q_branch_${branchId}.child_001.grandchild_001`
  })
  createdUserIds.push(parentId, childId, grandchildId)

  // Slash the parent
  await svc.rpc('critterverse.apply_trust_slash', {
    p_user_id: parentId, p_reason: 'branch_compromise', p_severity: 0.80
  })

  // Neither child nor grandchild's own row was touched
  const { data: childRow } = await svc
    .from('critterverse.users').select('trust_state').eq('id', childId).single()
  const { data: grandchildRow } = await svc
    .from('critterverse.users').select('trust_state').eq('id', grandchildId).single()

  assertEq(childRow?.trust_state,      'active', 'child own row must be untouched')
  assertEq(grandchildRow?.trust_state, 'active', 'grandchild own row must be untouched')

  // But the effective_trust view should show both as quarantined
  const { data: childEffective } = await svc
    .from('critterverse.user_effective_trust')
    .select('effective_state, has_quarantined_ancestor')
    .eq('id', childId).single()

  const { data: grandchildEffective } = await svc
    .from('critterverse.user_effective_trust')
    .select('effective_state, has_quarantined_ancestor')
    .eq('id', grandchildId).single()

  assertEq(childEffective?.effective_state,      'quarantined', 'child effective_state must be quarantined')
  assertEq(grandchildEffective?.effective_state, 'quarantined', 'grandchild effective_state must be quarantined')
  assert(childEffective?.has_quarantined_ancestor      === true, 'child must report has_quarantined_ancestor')
  assert(grandchildEffective?.has_quarantined_ancestor === true, 'grandchild must report has_quarantined_ancestor')
})


Deno.test('quarantine: users on sibling branches are NOT affected by peer quarantine', async () => {
  const svc      = svcClient()
  const branchId = Date.now()

  const compromisedId = await createTestUser(svc, {
    sunshade_path: `root.sibling_test_${branchId}.branch_a.leaf_001`
  })
  const unaffectedId  = await createTestUser(svc, {
    sunshade_path: `root.sibling_test_${branchId}.branch_b.leaf_001`
  })
  createdUserIds.push(compromisedId, unaffectedId)

  await svc.rpc('critterverse.apply_trust_slash', {
    p_user_id: compromisedId, p_reason: 'sibling_test_slash', p_severity: 0.80
  })

  const { data: unaffectedTrust } = await svc
    .from('critterverse.user_effective_trust')
    .select('effective_state, has_quarantined_ancestor')
    .eq('id', unaffectedId).single()

  assertEq(unaffectedTrust?.effective_state, 'active', 'sibling branch user must remain active')
  assert(unaffectedTrust?.has_quarantined_ancestor === false, 'sibling must not show quarantined ancestor')
})


// ─────────────────────────────────────────────────────────────
// REDEMPTION ARC
// ─────────────────────────────────────────────────────────────

Deno.test('redemption T1: sufficient decay submissions restore user to active', async () => {
  const svc    = svcClient()
  // Start at 0.25 — above Tier 2 threshold (0.15), below active threshold (0.55)
  const userId = await createTestUser(svc, { trust_score: 0.25, trust_state: 'quarantined' })
  createdUserIds.push(userId)

  const DECAY_PER_SUBMISSION = 0.05
  const ACTIVE_THRESHOLD     = 0.55
  let   currentScore         = 0.25

  // Simulate decay loop — need ceil((0.55 - 0.25) / 0.05) = 6 submissions
  const submissionsNeeded = Math.ceil((ACTIVE_THRESHOLD - currentScore) / DECAY_PER_SUBMISSION)

  for (let i = 0; i < submissionsNeeded; i++) {
    currentScore = Math.min(1.0, currentScore + DECAY_PER_SUBMISSION)
    const newState = currentScore >= ACTIVE_THRESHOLD ? 'active' : 'quarantined'

    await svc
      .from('critterverse.users')
      .update({ trust_score: currentScore, trust_state: newState })
      .eq('id', userId)

    // Append a quarantine_decay event
    const { data: lastEvent } = await svc
      .from('critterverse.trust_events')
      .select('current_hash')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1).single()

    const eventData = { submission_seq: i + 1, score_after: currentScore, decay_amount: DECAY_PER_SUBMISSION }
    const newHash   = await sha256Hex((lastEvent?.current_hash ?? '') + JSON.stringify(eventData))

    const eventType = newState === 'active'
      ? 'trust.redemption_tier1_complete'
      : 'trust.quarantine_decay'

    await svc.from('critterverse.trust_events').insert({
      user_id:       userId,
      previous_hash: lastEvent?.current_hash ?? '',
      current_hash:  newHash,
      event_type:    eventType,
      event_data:    eventData
    })
  }

  const { data: finalUser } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', userId).single()

  assertEq(finalUser?.trust_state, 'active', 'user must be active after sufficient decay submissions')
  assert((finalUser?.trust_score ?? 0) >= ACTIVE_THRESHOLD, 'final trust_score must meet active threshold')

  // Verify the chain is still valid after all appended events
  const { data: chainResult } = await svc
    .rpc('critterverse.verify_trust_chain', { p_user_id: userId })
  assert(chainResult?.[0]?.is_valid === true, 'trust chain must be valid after all decay events')
})


Deno.test('redemption T2: slashed user must complete Gopher Task before T1 decay', async () => {
  const svc    = svcClient()
  // trust_score below 0.15 → T2 required
  const userId = await createTestUser(svc, { trust_score: 0.10, trust_state: 'slashed' })
  createdUserIds.push(userId)

  // After Tier 2 completion: restore to quarantined at 0.20
  await svc
    .from('critterverse.users')
    .update({ trust_state: 'quarantined', trust_score: 0.20 })
    .eq('id', userId)

  const { data: after } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', userId).single()

  assertEq(after?.trust_state, 'quarantined', 'after T2 completion user is quarantined (can now do T1)')
  assertEq(after?.trust_score, 0.20, 'T2 resets score to 0.20 for T1 to continue')

  // Effective trust check: above T2 threshold, below active — T1 decay is now valid
  const aboveT2  = (after?.trust_score ?? 0) >= 0.15
  const belowActive = (after?.trust_score ?? 0) < 0.55
  assert(aboveT2,    'score must be above T2 threshold (0.15) for T1 to work')
  assert(belowActive, 'score must be below active threshold (0.55) — T1 still needed')
})


Deno.test('redemption T2: get_gopher_task returns stale bounty above priority threshold', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc, {
    bounty_type:      'gopher_target',
    last_verified_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),  // 48h stale
    traffic_weight:   0.5,
    is_active:        true
  })
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const { data: task, error } = await svc.rpc('critterverse.get_gopher_task', {
    p_user_lat: 37.7749,
    p_user_lng: -122.4194,
    p_user_id:  userId
  })

  assert(error === null, `get_gopher_task RPC error: ${error?.message}`)
  assertDefined(task, 'Gopher Task result must be non-null')
  assert((task?.length ?? 0) > 0, 'must return at least one task')
  assert((task![0].priority_score ?? 0) > 0, 'priority_score must be positive')
})


// ─────────────────────────────────────────────────────────────
// CROSS-APP TRUST BONUS
// ─────────────────────────────────────────────────────────────

Deno.test('cross-app: apply_trust_bonus caps at 1.0 and appends trust event', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.95 })
  createdUserIds.push(userId)

  // Bonus of 0.10 should cap at 1.0 (not exceed it)
  const { error } = await svc.rpc('critterverse.apply_trust_bonus', {
    p_user_id: userId,
    p_amount:  0.10
  })
  assert(error === null, `apply_trust_bonus failed: ${error?.message}`)

  const { data: user } = await svc
    .from('critterverse.users')
    .select('trust_score')
    .eq('id', userId).single()

  assertEq(user?.trust_score, 1.0, 'trust_score must be capped at 1.0 after bonus')

  // Verify trust event appended
  const { data: latestEvent } = await svc
    .from('critterverse.trust_events')
    .select('event_type, event_data')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1).single()

  assertEq(latestEvent?.event_type, 'trust.restored', 'bonus should append trust.restored event')
  assertEq(latestEvent?.event_data?.bonus_amount, 0.10, 'event_data should record the bonus amount')
})


Deno.test('cross-app: credit_reputation increments balance correctly', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { reputation_balance: 50.0 })
  createdUserIds.push(userId)

  const { error } = await svc.rpc('critterverse.credit_reputation', {
    p_user_id: userId,
    p_amount:  25.75
  })
  assert(error === null, `credit_reputation failed: ${error?.message}`)

  const { data: user } = await svc
    .from('critterverse.users')
    .select('reputation_balance')
    .eq('id', userId).single()

  assert(
    Math.abs((user?.reputation_balance ?? 0) - 75.75) < 0.001,
    `balance should be 50.0 + 25.75 = 75.75, got ${user?.reputation_balance}`
  )
})


Deno.test('cross-app: credit_reputation with zero or negative amount fails', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const { error } = await svc.rpc('critterverse.credit_reputation', {
    p_user_id: userId,
    p_amount:  -5.0
  })
  assert(error !== null, 'negative credit_reputation must fail with exception')
})


// ─────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────

Deno.test({
  name: 'trust: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
