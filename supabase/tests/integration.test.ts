/**
 * tests/integration.test.ts
 * End-to-end tests for the two client-facing polling endpoints:
 *   - public/submission-status  (pipeline state tracker)
 *   - council/voter-status      (council inbox + action routing)
 *
 * These tests simulate a complete submission lifecycle and
 * verify that each endpoint returns the correct data and
 * narrative copy at every pipeline stage.
 *
 * Run: deno test tests/integration.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined,
  sha256Hex, SUPABASE_URL, GENESIS_HASH
} from './setup.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ??
  'super-secret-jwt-token-with-at-least-32-characters-long'

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []

/** Mint a test JWT for authenticated calls */
async function mintJwt(userId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const payload = btoa(JSON.stringify({
    aud: 'authenticated', iss: 'https://sunshade.network',
    role: 'authenticated', sub: userId,
    iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    trust_state: 'active', ...extra
  })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  return `${header}.${payload}.${sigB64}`
}

async function authFetch(path: string, userId: string, opts: RequestInit = {}): Promise<Response> {
  const jwt = await mintJwt(userId)
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
      ...(opts.headers ?? {})
    }
  })
}


// ─────────────────────────────────────────────────────────────
// SUBMISSION STATUS ENDPOINT
// ─────────────────────────────────────────────────────────────

Deno.test('submission-status: returns 404 for unknown submission_id', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const res  = await authFetch(`public/submission-status?submission_id=${crypto.randomUUID()}`, userId)
  assertEq(res.status, 404, 'unknown submission should return 404')
})


Deno.test('submission-status: returns 404 for submission owned by another user', async () => {
  const svc      = svcClient()
  const owner    = await createTestUser(svc)
  const stranger = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(owner, stranger)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, owner, bountyId)

  // stranger tries to query owner's submission — RLS should return 404
  const res = await authFetch(`public/submission-status?submission_id=${subId}`, stranger)
  assertEq(res.status, 404, 'cross-user submission access must return 404 via RLS filtering')
})


Deno.test('submission-status: initiated state returns correct structure and narrative', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc, { alpha_label: 'Cavern Entrance #TEST' })
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'initiated' })

  // Log the initiation pipeline event so the progress calc works
  await svc.from('critterverse.pipeline_events').insert({
    submission_id: subId, event_type: 'submission.initiated', event_data: {}
  })

  const res  = await authFetch(`public/submission-status?submission_id=${subId}`, userId)
  assertEq(res.status, 200, 'initiated submission should return 200')

  const body = await res.json()
  assertEq(body.submission_id, subId,      'submission_id must match')
  assertEq(body.status,        'initiated', 'status must be initiated')
  assertDefined(body.narrative,             'narrative block must be present')
  assertDefined(body.narrative.title,       'narrative.title must be present')
  assert(body.narrative.title.length > 0,   'narrative.title must not be empty')
  assertEq(body.bounty.alpha_label, 'Cavern Entrance #TEST', 'bounty alpha_label must match')
  assert(body.progress_pct >= 0 && body.progress_pct <= 100, 'progress_pct must be 0-100')
  assert(body.council === null, 'council must be null for initiated state')
  assert(body.critter_drop === null, 'critter_drop must be null for initiated state')
})


Deno.test('submission-status: verified state returns reward data', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, {
    status:            'verified',
    ai_confidence:     0.92,
    ai_classification: 'plastic_bottle',
    reward_multiplier: 1.0,
    reward_amount:     10.0,
    reward_paid_at:    new Date().toISOString(),
    processed_at:      new Date().toISOString()
  })

  await svc.from('critterverse.pipeline_events').insert([
    { submission_id: subId, event_type: 'submission.initiated',    event_data: {} },
    { submission_id: subId, event_type: 'zkp.validation_started',  event_data: {} },
    { submission_id: subId, event_type: 'zkp.status',              event_data: { is_valid: true } },
    { submission_id: subId, event_type: 'hashing.processed',       event_data: { ai_confidence: 0.92 } },
    { submission_id: subId, event_type: 'storage.purged',          event_data: {} }
  ])

  const res  = await authFetch(`public/submission-status?submission_id=${subId}`, userId)
  const body = await res.json()

  assertEq(body.status, 'verified', 'status must be verified')
  assertEq(body.progress_pct, 100,  'verified submission must be 100% complete')
  assertDefined(body.reward,         'reward block must be present for verified submission')
  assertEq(body.reward.amount, 10.0, 'reward amount must match')
  assert(body.council === null,       'council must be null for verified (non-anomalous) submission')
})


Deno.test('submission-status: anomalous state returns council session info', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, {
    status: 'anomalous', ai_confidence: 0.28, processed_at: new Date().toISOString()
  })

  const { data: archive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.28, archive_status: 'pending_review' })
    .select('id').single()

  // Open a council session
  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archive!.id, session_status: 'active',
      voting_deadline: new Date(Date.now() + 48*3600*1000).toISOString(),
      reveal_deadline: new Date(Date.now() + 72*3600*1000).toISOString()
    })
    .select('id').single()

  await svc.from('critterverse.anomalous_archive_queue')
    .update({ archive_status: 'in_review', council_session_id: session!.id })
    .eq('id', archive!.id)

  const res  = await authFetch(`public/submission-status?submission_id=${subId}`, userId)
  const body = await res.json()

  assertEq(body.status, 'anomalous', 'status must be anomalous')
  assertDefined(body.council,               'council block must be present for anomalous submission')
  assertEq(body.council.session_id, session!.id, 'council.session_id must match')
  assertEq(body.council.session_status, 'active', 'council.session_status must be active')
  assertDefined(body.council.voting_deadline, 'council.voting_deadline must be set')
  assertDefined(body.council.narrative,       'council narrative must be present')
})


Deno.test('submission-status: over-achiever trap appears in pedometer block', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId)

  await svc.from('critterverse.pedometer_bounds').insert({
    submission_id: subId, start_lat: 37.77, start_lng: -122.41,
    target_lat: 37.77, target_lng: -122.42,
    haversine_distance_m: 800.0, stride_length_cm: 76.0, variance_buffer_pct: 0.20,
    expected_steps: 1053, min_steps_allowed: 842, max_steps_allowed: 1264,
    reported_steps: 5000, is_over_achiever_trap: true
  })

  const res  = await authFetch(`public/submission-status?submission_id=${subId}`, userId)
  const body = await res.json()

  assertDefined(body.over_achiever_trap, 'over_achiever_trap block must be present')
  assert(body.over_achiever_trap.triggered === true, 'trap.triggered must be true')
  assertDefined(body.over_achiever_trap.narrative, 'trap.narrative must be present')
})


// ─────────────────────────────────────────────────────────────
// VOTER STATUS ENDPOINT
// ─────────────────────────────────────────────────────────────

Deno.test('voter-status: returns empty array for user with no invitations', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const res  = await authFetch('council/voter-status', userId)
  assertEq(res.status, 200, 'should return 200 for user with no invitations')

  const body = await res.json()
  assertEq(body.sessions.length,       0, 'sessions must be empty')
  assertEq(body.pending_action_count,  0, 'pending_action_count must be 0')
})


Deno.test('voter-status: invited voter sees accept_or_decline action', async () => {
  const svc       = svcClient()
  const voterId   = await createTestUser(svc, { archivist_eligible: true })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voterId, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })

  const { data: archive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.35, archive_status: 'pending_review' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archive!.id, session_status: 'selecting_voters',
      voting_deadline: new Date(Date.now() + 48*3600*1000).toISOString(),
      reveal_deadline: new Date(Date.now() + 72*3600*1000).toISOString()
    })
    .select('id').single()

  await svc.from('critterverse.council_voter_selection').insert({
    session_id: session!.id, voter_user_id: voterId,
    hop_distance: 4, status: 'invited'
  })

  const res  = await authFetch('council/voter-status', voterId)
  const body = await res.json()

  assertEq(body.sessions.length, 1, 'one session must appear')
  assertEq(body.pending_action_count, 1, 'pending_action_count must be 1')
  assertEq(body.sessions[0].action_required, 'accept_or_decline', 'action must be accept_or_decline')
  assertDefined(body.sessions[0].narrative, 'narrative must be present')
  assert(body.sessions[0].narrative.length > 0, 'narrative must not be empty')
})


Deno.test('voter-status: accepted voter in active session sees cast_vote action', async () => {
  const svc       = svcClient()
  const voterId   = await createTestUser(svc, { archivist_eligible: true, reputation_balance: 200.0 })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voterId, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })

  const { data: archive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.40, archive_status: 'in_review' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archive!.id, session_status: 'active',
      voting_deadline: new Date(Date.now() + 48*3600*1000).toISOString(),
      reveal_deadline: new Date(Date.now() + 72*3600*1000).toISOString()
    })
    .select('id').single()

  await svc.from('critterverse.anomalous_archive_queue')
    .update({ council_session_id: session!.id })
    .eq('id', archive!.id)

  // Voter has accepted but not yet voted
  await svc.from('critterverse.council_voter_selection').insert({
    session_id: session!.id, voter_user_id: voterId,
    hop_distance: 5, status: 'accepted', responded_at: new Date().toISOString()
  })

  const res  = await authFetch('council/voter-status', voterId)
  const body = await res.json()

  assertEq(body.sessions.length, 1, 'one session must appear')
  assertEq(body.sessions[0].action_required, 'cast_vote', 'action must be cast_vote')
  assert(body.sessions[0].has_committed === false, 'has_committed must be false before voting')
  assertDefined(body.sessions[0].voting_deadline, 'voting_deadline must be present')
})


Deno.test('voter-status: committed voter in reveal phase sees reveal_vote action', async () => {
  const svc       = svcClient()
  const voterId   = await createTestUser(svc, { archivist_eligible: true })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voterId, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })
  const { data: archive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.40, archive_status: 'in_review' })
    .select('id').single()

  // Voting deadline has already PASSED → reveal phase open
  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archive!.id, session_status: 'reveal_phase',
      voting_deadline: new Date(Date.now() - 1000).toISOString(),    // already past
      reveal_deadline: new Date(Date.now() + 24*3600*1000).toISOString()
    })
    .select('id').single()

  await svc.from('critterverse.anomalous_archive_queue')
    .update({ council_session_id: session!.id }).eq('id', archive!.id)

  await svc.from('critterverse.council_voter_selection').insert({
    session_id: session!.id, voter_user_id: voterId,
    hop_distance: 4, status: 'accepted', responded_at: new Date().toISOString()
  })

  // Insert a committed vote (not yet revealed)
  const fakeCommitHash = await sha256Hex('legitimate:some-salt')
  await svc.from('critterverse.council_votes').insert({
    session_id: session!.id, voter_user_id: voterId,
    vote_commitment_hash: fakeCommitHash, stake_amount: 15.0,
    stake_locked_at: new Date().toISOString()
  })

  const res  = await authFetch('council/voter-status', voterId)
  const body = await res.json()

  assertEq(body.sessions.length, 1, 'one session must appear')
  assertEq(body.sessions[0].action_required, 'reveal_vote', 'action must be reveal_vote')
  assert(body.sessions[0].has_committed === true,  'has_committed must be true')
  assert(body.sessions[0].has_revealed  === false, 'has_revealed must be false')
  assertDefined(body.sessions[0].reveal_deadline, 'reveal_deadline must be present')
})


Deno.test('voter-status: resolved session shows outcome narrative without action', async () => {
  const svc       = svcClient()
  const voterId   = await createTestUser(svc, { archivist_eligible: true })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voterId, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })
  const { data: archive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.40, archive_status: 'resolved_legitimate' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id:  archive!.id, session_status: 'completed',
      consensus_result: 'legitimate', total_staked: 100.0,
      majority_stake: 60.0, minority_stake: 40.0,
      voting_deadline: new Date(Date.now() - 2*24*3600*1000).toISOString(),
      reveal_deadline: new Date(Date.now() - 24*3600*1000).toISOString(),
      resolved_at:     new Date().toISOString()
    })
    .select('id').single()

  await svc.from('critterverse.anomalous_archive_queue')
    .update({ council_session_id: session!.id }).eq('id', archive!.id)

  await svc.from('critterverse.council_voter_selection').insert({
    session_id: session!.id, voter_user_id: voterId,
    hop_distance: 4, status: 'accepted', responded_at: new Date().toISOString()
  })

  // Voter was majority — positive delta
  const fakeHash = await sha256Hex('legitimate:resolved-salt')
  await svc.from('critterverse.council_votes').insert({
    session_id: session!.id, voter_user_id: voterId,
    vote_commitment_hash: fakeHash, stake_amount: 20.0,
    revealed_vote: 'legitimate', revealed_salt: 'resolved-salt',
    revealed_at: new Date().toISOString(), reveal_valid: true,
    is_majority: true, stake_delta: 13.33, resolved_at: new Date().toISOString()
  })

  const res  = await authFetch('council/voter-status', voterId)
  const body = await res.json()

  assertEq(body.sessions[0].action_required,  null,           'no action required for resolved session')
  assertEq(body.sessions[0].session_status,   'completed',    'session_status must be completed')
  assertEq(body.sessions[0].consensus_result, 'legitimate',   'consensus_result must be legitimate')
  assert(body.sessions[0].is_majority === true,               'is_majority must be true')
  assert((body.sessions[0].stake_delta ?? 0) > 0,            'majority voter stake_delta must be positive')
  assertDefined(body.sessions[0].narrative, 'narrative must be present for resolved session')
  assert(body.pending_action_count === 0,    'no pending actions for resolved session')
})


// ── Cleanup ───────────────────────────────────────────────────
Deno.test({
  name: 'integration: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
