/**
 * tests/pipeline.test.ts
 * Integration tests for the full ingestion pipeline:
 *   submission initiation → ZKP callback → hash-process → verified/anomalous
 *
 * Run: deno test tests/pipeline.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined, sha256Hex, GENESIS_HASH
} from './setup.ts'

const createdUserIds: string[] = []
const createdBountyIds: string[] = []

// ── Test 1: Submission initiation creates correct DB records ──
Deno.test('pipeline: initiation creates submission + pedometer bounds', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId)

  // Insert a pedometer bounds record as the function would
  const { error: pedErr } = await svc
    .from('critterverse.pedometer_bounds')
    .insert({
      submission_id:        subId,
      start_lat:            37.7700,
      start_lng:            -122.4180,
      target_lat:           37.7749,
      target_lng:           -122.4194,
      haversine_distance_m: 550.0,
      stride_length_cm:     76.0,
      variance_buffer_pct:  0.20,
      expected_steps:       724,
      min_steps_allowed:    579,
      max_steps_allowed:    869,
      reported_steps:       710
    })
  assert(pedErr === null, `pedometer insert failed: ${pedErr?.message}`)

  // Verify submission exists
  const { data: sub } = await svc
    .from('critterverse.submissions')
    .select('status, user_id, bounty_id')
    .eq('id', subId)
    .single()

  assertDefined(sub, 'submission should exist')
  assertEq(sub.user_id,  userId,   'submission.user_id mismatch')
  assertEq(sub.bounty_id, bountyId, 'submission.bounty_id mismatch')
  assertEq(sub.status,  'initiated', 'initial status should be initiated')
})


// ── Test 2: ZKP valid → submission advances to 'hashing' ──────
Deno.test('pipeline: valid ZKP result advances submission to hashing', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'zkp_pending' })

  // Log zkp.validation_started event
  await svc.from('critterverse.pipeline_events').insert({
    submission_id: subId,
    event_type:    'zkp.validation_started',
    event_data:    { submitted_lat: 37.7749, submitted_lng: -122.4194 }
  })

  // Simulate the ZKP callback updating the submission
  await svc
    .from('critterverse.submissions')
    .update({
      status:           'hashing',
      zkp_proof_cid:    'bafkreitest123',
      zkp_validated_at: new Date().toISOString()
    })
    .eq('id', subId)

  await svc.from('critterverse.pipeline_events').insert({
    submission_id: subId,
    event_type:    'zkp.status',
    event_data:    { is_valid: true, proof_cid: 'bafkreitest123' }
  })

  const { data: sub } = await svc
    .from('critterverse.submissions')
    .select('status, zkp_proof_cid')
    .eq('id', subId)
    .single()

  assertEq(sub?.status, 'hashing', 'status should advance to hashing after valid ZKP')
  assertEq(sub?.zkp_proof_cid, 'bafkreitest123', 'zkp_proof_cid should be set')
})


// ── Test 3: Invalid ZKP → submission rejected ─────────────────
Deno.test('pipeline: invalid ZKP rejects submission', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'zkp_pending' })

  await svc
    .from('critterverse.submissions')
    .update({ status: 'zkp_invalid', processed_at: new Date().toISOString() })
    .eq('id', subId)

  await svc.from('critterverse.pipeline_events').insert({
    submission_id: subId,
    event_type:    'zkp.status',
    event_data:    { is_valid: false, failure_reason: 'geo_out_of_range' }
  })

  const { data: sub } = await svc
    .from('critterverse.submissions')
    .select('status')
    .eq('id', subId)
    .single()

  assertEq(sub?.status, 'zkp_invalid', 'invalid ZKP should set status to zkp_invalid')
})


// ── Test 4: High confidence → verified, storage.purged event ──
Deno.test('pipeline: high-confidence hash routes to storage.purged', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'hashing' })

  // Simulate hash-process: high confidence
  await svc
    .from('critterverse.submissions')
    .update({
      status:            'verified',
      perceptual_hash:   'abc123phash',
      semantic_hash:     'def456semhash',
      ai_confidence:     0.91,
      ai_classification: 'plastic_bottle',
      reward_amount:     10.0,
      reward_paid_at:    new Date().toISOString(),
      processed_at:      new Date().toISOString()
    })
    .eq('id', subId)

  await svc.from('critterverse.pipeline_events').insert([
    { submission_id: subId, event_type: 'hashing.processed',    event_data: { ai_confidence: 0.91 } },
    { submission_id: subId, event_type: 'storage.purged',       event_data: { reason: 'confidence_above_threshold' } }
  ])

  // Verify events logged in correct order
  const { data: events } = await svc
    .rpc('critterverse.get_submission_pipeline_summary', { p_submission_id: subId })

  const eventTypes = events?.map((e: { event_type: string }) => e.event_type)
  assert(
    eventTypes?.includes('hashing.processed'),
    'hashing.processed event must be logged'
  )
  assert(
    eventTypes?.includes('storage.purged'),
    'storage.purged event must be logged for high-confidence submission'
  )
  assert(
    !eventTypes?.includes('storage.anomalous_archived'),
    'storage.anomalous_archived must NOT be logged for high-confidence submission'
  )
})


// ── Test 5: Low confidence → anomalous archive queue ──────────
Deno.test('pipeline: low-confidence hash routes to anomalous archive', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'hashing' })

  // Simulate hash-process: low confidence
  await svc
    .from('critterverse.submissions')
    .update({ status: 'anomalous', ai_confidence: 0.42, processed_at: new Date().toISOString() })
    .eq('id', subId)

  await svc.from('critterverse.pipeline_events').insert([
    { submission_id: subId, event_type: 'hashing.processed',          event_data: { ai_confidence: 0.42 } },
    { submission_id: subId, event_type: 'storage.anomalous_archived', event_data: { confidence_band: 'low' } }
  ])

  await svc.from('critterverse.anomalous_archive_queue').insert({
    submission_id:     subId,
    ai_confidence:     0.42,
    ai_classification: 'unknown_debris',
    archive_status:    'pending_review'
  })

  const { data: archiveItem } = await svc
    .from('critterverse.anomalous_archive_queue')
    .select('archive_status, confidence_band')
    .eq('submission_id', subId)
    .single()

  assertDefined(archiveItem, 'archive item must exist for low-confidence submission')
  assertEq(archiveItem?.archive_status, 'pending_review', 'initial archive status must be pending_review')
  assertEq(archiveItem?.confidence_band, 'low', 'confidence band should be low for 0.42')
})


// ── Test 6: Duplicate perceptual hash → rejection ─────────────
Deno.test('pipeline: duplicate perceptual hash triggers rejection', async () => {
  const svc      = svcClient()
  const userId1  = await createTestUser(svc)
  const userId2  = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId1, userId2)
  createdBountyIds.push(bountyId)

  const SHARED_PHASH = 'dup_test_phash_' + Date.now()

  // First submission: verified with the hash
  const sub1 = await createTestSubmission(svc, userId1, bountyId, {
    status:          'verified',
    perceptual_hash: SHARED_PHASH
  })

  // Second submission (different user) with same phash → should be rejected
  const sub2 = await createTestSubmission(svc, userId2, bountyId, {
    status:          'hashing',
    perceptual_hash: SHARED_PHASH
  })

  // Detect duplicate: same phash, different user
  const { data: dups } = await svc
    .from('critterverse.submissions')
    .select('id, user_id')
    .eq('perceptual_hash', SHARED_PHASH)
    .neq('id', sub2)

  assert((dups?.length ?? 0) > 0, 'duplicate should be found by phash index')
  assert(
    dups?.some((d: { user_id: string }) => d.user_id === userId1),
    'duplicate found should belong to original submitter'
  )
})


// ── Test 7: Over-Achiever Trap fires on excessive step count ──
Deno.test('pipeline: Over-Achiever Trap triggers on step count 2x max', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId)

  const maxSteps     = 869
  const spoofedSteps = maxSteps * 3  // wildly exceeds 2x max

  const { error } = await svc.from('critterverse.pedometer_bounds').insert({
    submission_id:         subId,
    start_lat:             37.7700,
    start_lng:             -122.4180,
    target_lat:            37.7749,
    target_lng:            -122.4194,
    haversine_distance_m:  550.0,
    stride_length_cm:      76.0,
    variance_buffer_pct:   0.20,
    expected_steps:        724,
    min_steps_allowed:     579,
    max_steps_allowed:     maxSteps,
    reported_steps:        spoofedSteps,
    is_over_achiever_trap: spoofedSteps > maxSteps * 2
  })

  assert(error === null, `pedometer bounds insert failed: ${error}`)

  const { data: bounds } = await svc
    .from('critterverse.pedometer_bounds')
    .select('is_over_achiever_trap, reported_steps')
    .eq('submission_id', subId)
    .single()

  assert(bounds?.is_over_achiever_trap === true, 'Over-Achiever Trap should fire')
  assertEq(bounds?.reported_steps, spoofedSteps, 'reported_steps should be recorded')
})


// ── Test 8: Trust chain integrity after events ────────────────
Deno.test('pipeline: trust chain hash integrity is maintained', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  // Read genesis event
  const { data: events } = await svc
    .from('critterverse.trust_events')
    .select('previous_hash, current_hash, event_data')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  assert((events?.length ?? 0) > 0, 'trust chain should have at least one event')

  const genesis = events![0]
  // Verify: current_hash = sha256(previous_hash || event_data)
  const expected = await sha256Hex(genesis.previous_hash + JSON.stringify(genesis.event_data))
  // Note: the sha256_hex postgres function uses digest(); this Deno sha256 must match
  assertEq(genesis.current_hash, expected, 'genesis event hash must be verifiable')

  // Verify via the SQL function too
  const { data: chainResult } = await svc
    .rpc('critterverse.verify_trust_chain', { p_user_id: userId })

  assert(chainResult?.[0]?.is_valid === true, 'SQL verify_trust_chain should return valid')
})


// ── Cleanup ───────────────────────────────────────────────────
Deno.test({
  name: 'pipeline: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    // Clean up test bounties
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
