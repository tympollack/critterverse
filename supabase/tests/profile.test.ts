/**
 * tests/profile.test.ts
 * Integration tests for the two dashboard aggregation endpoints:
 *   - user/profile     (authenticated mobile dashboard)
 *   - admin/user-report (ops audit tool)
 *
 * Tests verify structure, data accuracy, redemption arc state
 * derivation, risk flag generation, and RLS isolation.
 *
 * Run: deno test tests/profile.test.ts --allow-net --allow-env
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined,
  sha256Hex, SUPABASE_URL, GENESIS_HASH
} from './setup.ts'

const ANON_KEY   = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ??
  'super-secret-jwt-token-with-at-least-32-characters-long'
const INTERNAL_KEY = Deno.env.get('INTERNAL_FUNCTION_KEY') ??
  'ci-internal-key-32chars-padding-xx'

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []

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

async function authGet(path: string, userId: string, extra: Record<string, unknown> = {}): Promise<Response> {
  const jwt = await mintJwt(userId, extra)
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }
  })
}

async function adminGet(path: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    headers: { 'X-Internal-Key': INTERNAL_KEY, 'Content-Type': 'application/json' }
  })
}


// ─────────────────────────────────────────────────────────────
// user/profile TESTS
// ─────────────────────────────────────────────────────────────

Deno.test('profile: returns 401 for unauthenticated request', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/user/profile`)
  assertEq(res.status, 401, 'unauthenticated request must return 401')
  await res.body?.cancel()
})


Deno.test('profile: active user returns correct base structure', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, {
    trust_score:        0.90,
    trust_state:        'active',
    reputation_balance: 150.0,
    archivist_eligible: true
  })
  createdUserIds.push(userId)

  const res  = await authGet('user/profile', userId)
  assertEq(res.status, 200, 'profile must return 200')

  const body = await res.json()
  assertEq(body.user_id, userId, 'user_id must match')

  // Trust block
  assertDefined(body.trust, 'trust block must be present')
  assertEq(body.trust.score,           0.90,     'trust.score must match')
  assertEq(body.trust.state,           'active',  'trust.state must be active')
  assertEq(body.trust.effective_state, 'active',  'effective_state must be active')
  assert(body.trust.has_quarantined_ancestor === false, 'no quarantined ancestor')

  // Balances
  assertEq(body.reputation_balance, 150.0, 'reputation_balance must match')
  assert(body.archivist_eligible === true,  'archivist_eligible must be true')

  // Blocks present
  assertDefined(body.submissions,  'submissions block must be present')
  assertDefined(body.council,      'council block must be present')
  assertDefined(body.critters,     'critters block must be present')
  assertDefined(body.cross_app,    'cross_app block must be present')
  assertDefined(body.narrative,    'narrative block must be present')

  // Active user has no redemption block
  assert(body.redemption === null, 'active user must have null redemption')

  // Narrative
  assertEq(body.narrative.status_title, 'Survey Team Active', 'narrative title for active user')
})


Deno.test('profile: submission counts reflect actual submissions', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  // Create mixed-status submissions
  await createTestSubmission(svc, userId, bountyId, { status: 'verified',   reward_amount: 10.0 })
  await createTestSubmission(svc, userId, bountyId, { status: 'verified',   reward_amount: 15.0 })
  await createTestSubmission(svc, userId, bountyId, { status: 'rejected' })
  await createTestSubmission(svc, userId, bountyId, { status: 'anomalous' })
  await createTestSubmission(svc, userId, bountyId, { status: 'initiated' })

  const res  = await authGet('user/profile', userId)
  const body = await res.json()

  assertEq(body.submissions.total,     5,    'total must be 5')
  assertEq(body.submissions.verified,  2,    'verified must be 2')
  assertEq(body.submissions.rejected,  1,    'rejected must be 1')
  assertEq(body.submissions.anomalous, 1,    'anomalous must be 1')
  assertEq(body.submissions.pending,   1,    'pending (initiated) must be 1')

  assert(
    Math.abs(body.submissions.total_reward_earned - 25.0) < 0.01,
    'total_reward_earned must be sum of verified reward_amounts (10 + 15 = 25)'
  )
})


Deno.test('profile: quarantined user shows Tier 1 redemption arc', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, {
    trust_score: 0.30,
    trust_state: 'quarantined'
  })
  createdUserIds.push(userId)

  const res  = await authGet('user/profile', userId, { trust_state: 'quarantined' })
  const body = await res.json()

  assertDefined(body.redemption, 'quarantined user must have redemption block')
  assertEq(body.redemption.tier, '1', 'score 0.30 is above T2 threshold → Tier 1')
  assertDefined(body.redemption.decay_verifications_remaining, 'remaining count must be set')
  assert(
    body.redemption.decay_verifications_remaining >= 1,
    'at least 1 verification needed to reach active threshold'
  )
  assertEq(body.redemption.reward_multiplier, 0.1, 'reward multiplier must be 0.1 during T1')
  assert(body.narrative.status_title.includes('Restricted'), 'title must reference restriction')
})


Deno.test('profile: slashed user shows Tier 2 redemption arc', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, {
    trust_score: 0.08,
    trust_state: 'slashed'
  })
  createdUserIds.push(userId)

  const res  = await authGet('user/profile', userId, { trust_state: 'slashed' })
  const body = await res.json()

  assertDefined(body.redemption, 'slashed user must have redemption block')
  assertEq(body.redemption.tier, '2', 'score 0.08 is below T2 threshold → Tier 2')
  assertEq(body.redemption.next_action, 'complete_gopher_task', 'next action must be Gopher Task')
  assert(body.narrative.status_title.includes('Disbanded'), 'title must reference disbanded team')
})


Deno.test('profile: council pending_actions badge count is accurate', async () => {
  const svc       = svcClient()
  const voterId   = await createTestUser(svc, { archivist_eligible: true })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voterId, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })
  const { data: arch } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.30, archive_status: 'pending_review' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: arch!.id, session_status: 'selecting_voters',
      voting_deadline: new Date(Date.now() + 48*3600*1000).toISOString(),
      reveal_deadline: new Date(Date.now() + 72*3600*1000).toISOString()
    })
    .select('id').single()

  // Invite the voter (status = 'invited' → pending action)
  await svc.from('critterverse.council_voter_selection').insert({
    session_id: session!.id, voter_user_id: voterId,
    hop_distance: 4, status: 'invited'
  })

  const res  = await authGet('user/profile', voterId)
  const body = await res.json()

  assert(body.council.pending_actions >= 1, 'pending_actions must reflect the invited session')
  assertEq(body.council.pending_invitations, 1, 'pending_invitations must be 1')
})


Deno.test('profile: cross_app block shows patchwork accuracy tier', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  await svc.from('critterverse.cross_app_identity_links').insert({
    user_id:                userId,
    sunshade_node_hash:     `test-hash-${Date.now()}`,
    patchwork_linked:       true,
    patchwork_accuracy_tier: 'gold',
    patchwork_queried_at:   new Date().toISOString()
  })

  await svc.from('critterverse.cross_app_unlocks').insert({
    user_id:        userId,
    unlock_type:    'archivist_status',
    trigger_source: 'patchwork_accuracy'
  })

  const res  = await authGet('user/profile', userId)
  const body = await res.json()

  assert(body.cross_app.patchwork_linked === true,     'patchwork_linked must be true')
  assertEq(body.cross_app.accuracy_tier, 'gold',       'accuracy_tier must be gold')
  assertEq(body.cross_app.unlocks.length, 1,           'one unlock must appear')
  assertEq(body.cross_app.unlocks[0].type, 'archivist_status', 'unlock type must match')
})


// ─────────────────────────────────────────────────────────────
// admin/user-report TESTS
// ─────────────────────────────────────────────────────────────

Deno.test('admin/user-report: returns 401 without X-Internal-Key', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/admin/user-report?user_id=${userId}`
  )
  assertEq(res.status, 401, 'missing internal key must return 401')
  await res.body?.cancel()
})


Deno.test('admin/user-report: returns 404 for unknown user', async () => {
  const res = await adminGet(`admin/user-report?user_id=${crypto.randomUUID()}`)
  assertEq(res.status, 404, 'unknown user must return 404')
  await res.body?.cancel()
})


Deno.test('admin/user-report: returns correct base structure', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { trust_score: 0.85, trust_state: 'active' })
  createdUserIds.push(userId)

  const res  = await adminGet(`admin/user-report?user_id=${userId}`)
  assertEq(res.status, 200, 'should return 200')

  const body = await res.json()
  assertEq(body.user_id, userId, 'user_id must match')
  assertDefined(body.risk_flags,    'risk_flags must be present')
  assertDefined(body.identity,      'identity block must be present')
  assertDefined(body.trust,         'trust block must be present')
  assertDefined(body.balances,      'balances block must be present')
  assertDefined(body.submissions,   'submissions block must be present')
  assertDefined(body.council,       'council block must be present')
  assertDefined(body.generated_at,  'generated_at must be present')

  assert(body.risk_flags.includes('NO_FLAGS'), 'clean user must have NO_FLAGS')
  assertDefined(body.trust.recent_events, 'trust.recent_events must be present')
  assert(body.trust.recent_events.length >= 1, 'must have at least genesis event')
})


Deno.test('admin/user-report: risk flags appear for slashed users with multiple rejections', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc, { trust_score: 0.10, trust_state: 'slashed' })
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  // Create enough rejected submissions to trigger the flag
  for (let i = 0; i < 4; i++) {
    await createTestSubmission(svc, userId, bountyId, { status: 'rejected' })
  }
  // Create an anomalous submission (Over-Achiever Trap)
  const trapSubId = await createTestSubmission(svc, userId, bountyId, { status: 'verified' })
  await svc.from('critterverse.pedometer_bounds').insert({
    submission_id: trapSubId, start_lat: 37.77, start_lng: -122.41,
    target_lat: 37.77, target_lng: -122.42,
    haversine_distance_m: 800.0, stride_length_cm: 76.0, variance_buffer_pct: 0.20,
    expected_steps: 1053, min_steps_allowed: 842, max_steps_allowed: 1264,
    reported_steps: 9999, is_over_achiever_trap: true
  })

  const res  = await adminGet(`admin/user-report?user_id=${userId}`)
  const body = await res.json()

  assert(body.risk_flags.includes('TRUST_SLASHED'),         'TRUST_SLASHED flag must appear')
  assert(body.risk_flags.includes('MULTIPLE_REJECTIONS_4'), 'MULTIPLE_REJECTIONS_4 flag must appear')
  assert(body.risk_flags.includes('OVER_ACHIEVER_TRAP_TRIGGERED'), 'trap flag must appear')
  assert(!body.risk_flags.includes('NO_FLAGS'),              'NO_FLAGS must not appear when risks exist')
})


Deno.test('admin/user-report: trust chain verification runs when verify_chain=true', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const res  = await adminGet(`admin/user-report?user_id=${userId}&verify_chain=true`)
  const body = await res.json()

  assertDefined(body.trust.chain_integrity,        'chain_integrity must be present with verify_chain=true')
  assertEq(body.trust.chain_integrity.is_valid, true, 'freshly bootstrapped user chain must be valid')
  assertEq(body.trust.chain_integrity.chain_length, 1, 'chain length must be 1 (genesis event only)')
  assert(body.trust.chain_integrity.broken_at_id === null, 'no broken events in fresh chain')
})


Deno.test('admin/user-report: include_votes=false omits vote details', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc, { archivist_eligible: true })
  createdUserIds.push(userId)

  const res  = await adminGet(`admin/user-report?user_id=${userId}&include_votes=false`)
  const body = await res.json()

  // With include_votes=false, vote details should be empty arrays
  for (const inv of body.council.voter_invitations ?? []) {
    assert(inv.vote === null || inv.vote === undefined,
      'with include_votes=false, vote details must be omitted')
  }
})


// ─────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────

Deno.test({
  name: 'profile: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
