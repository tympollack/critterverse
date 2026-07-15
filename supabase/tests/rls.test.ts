/**
 * tests/rls.test.ts
 * RLS policy enforcement tests.
 * Each test verifies that the Row Level Security boundary holds
 * against a user-JWT context (not service_role).
 *
 * These tests are the security regression suite.
 * A failure here means a data boundary has been breached.
 *
 * Run: deno test tests/rls.test.ts --allow-net --allow-env
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined, sha256Hex,
  SUPABASE_URL, SUPABASE_SERVICE_KEY
} from './setup.ts'

const ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []

/**
 * Build a minimal SunShade-style JWT signed with the test secret.
 * In local Supabase, the JWT secret is 'super-secret-jwt-token-with-at-least-32-characters-long'.
 */
async function mintTestJwt(userId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const payload = btoa(JSON.stringify({
    aud:  'authenticated',
    iss:  'https://sunshade.network',
    role: 'authenticated',
    sub:  userId,
    iat:  Math.floor(Date.now() / 1000),
    exp:  Math.floor(Date.now() / 1000) + 3600,
    ...extra
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwtSecret  = Deno.env.get('SUPABASE_JWT_SECRET') ??
    'super-secret-jwt-token-with-at-least-32-characters-long'
  const signingKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBuf  = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`${header}.${payload}`))
  const sig     = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  return `${header}.${payload}.${sig}`
}

/** Create an authenticated Supabase client using a minted JWT */
async function authClient(userId: string, extra: Record<string, unknown> = {}) {
  const jwt = await mintTestJwt(userId, extra)
  return createClient(SUPABASE_URL, ANON_KEY, {
    global:  { headers: { Authorization: `Bearer ${jwt}` } },
    auth:    { persistSession: false }
  })
}


// ─────────────────────────────────────────────────────────────
// USERS TABLE
// ─────────────────────────────────────────────────────────────

Deno.test('RLS users: user can read own record', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const client = await authClient(userId)
  const { data, error } = await client
    .from('critterverse.users')
    .select('id, trust_score')
    .eq('id', userId)

  assert(error === null, `expected no error, got: ${error?.message}`)
  assertEq(data?.length, 1, 'should return exactly one row (own record)')
  assertEq(data![0].id, userId, 'returned row must be own user')
})


Deno.test('RLS users: user cannot read other users\' records', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  createdUserIds.push(user1Id, user2Id)

  // user1 tries to read user2's record
  const client = await authClient(user1Id)
  const { data } = await client
    .from('critterverse.users')
    .select('id')
    .eq('id', user2Id)

  // RLS should return 0 rows (not an error — it just filters)
  assertEq((data?.length ?? 0), 0, 'user must not be able to read another user\'s record')
})


Deno.test('RLS users: client cannot INSERT a user directly', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const client = await authClient(userId)
  const nodeHash = await sha256Hex(`rls-inject-test-${Date.now()}`)

  const { error } = await client
    .from('critterverse.users')
    .insert({ sunshade_node_hash: nodeHash, sunshade_path: 'root.rls_test' })

  assert(error !== null, 'direct user INSERT must be blocked by RLS WITH CHECK (FALSE)')
})


// ─────────────────────────────────────────────────────────────
// TRUST EVENTS TABLE
// ─────────────────────────────────────────────────────────────

Deno.test('RLS trust_events: user can only read own events', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  createdUserIds.push(user1Id, user2Id)

  const client = await authClient(user1Id)
  const { data } = await client
    .from('critterverse.trust_events')
    .select('id, user_id')

  // All returned rows must belong to user1
  for (const row of (data ?? [])) {
    assertEq(row.user_id, user1Id, 'RLS must only return own trust events')
  }
})


Deno.test('RLS trust_events: client cannot INSERT trust events directly', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const client = await authClient(userId)
  const { error } = await client
    .from('critterverse.trust_events')
    .insert({
      user_id:       userId,
      previous_hash: 'fake',
      current_hash:  'fake2',
      event_type:    'trust.slashing',
      event_data:    {}
    })

  assert(error !== null, 'client INSERT on trust_events must be blocked by RLS')
})


// ─────────────────────────────────────────────────────────────
// BOUNTIES TABLE
// ─────────────────────────────────────────────────────────────

Deno.test('RLS bounties: active bounties are visible to all authenticated users', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc, { is_active: true, bounty_type: 'standard' })
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const client = await authClient(userId)
  const { data, error } = await client
    .from('critterverse.bounties')
    .select('id')
    .eq('id', bountyId)

  assert(error === null, `active bounty read failed: ${error?.message}`)
  assertEq(data?.length, 1, 'active bounty must be readable by authenticated user')
})


Deno.test('RLS bounties: quarantined user cannot see high_value or civic_audit bounties', async () => {
  const svc         = svcClient()
  const userId      = await createTestUser(svc, { trust_state: 'quarantined' })
  const hvBountyId  = await createTestBounty(svc, { bounty_type: 'high_value',  is_active: true })
  const stdBountyId = await createTestBounty(svc, { bounty_type: 'standard',    is_active: true })
  createdUserIds.push(userId)
  createdBountyIds.push(hvBountyId, stdBountyId)

  const client = await authClient(userId, { trust_state: 'quarantined' })

  const { data: hvData } = await client
    .from('critterverse.bounties')
    .select('id')
    .eq('id', hvBountyId)

  const { data: stdData } = await client
    .from('critterverse.bounties')
    .select('id')
    .eq('id', stdBountyId)

  assertEq((hvData?.length ?? 0), 0, 'quarantined user must NOT see high_value bounties')
  assertEq(stdData?.length, 1,        'quarantined user CAN see standard bounties')
})


Deno.test('RLS bounties: client cannot INSERT a bounty', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const client = await authClient(userId)
  const { error } = await client
    .from('critterverse.bounties')
    .insert({ geo_lat: 37.0, geo_lng: -122.0, bounty_type: 'standard', source: 'organic' })

  assert(error !== null, 'client INSERT on bounties must be blocked')
})


// ─────────────────────────────────────────────────────────────
// SUBMISSIONS TABLE
// ─────────────────────────────────────────────────────────────

Deno.test('RLS submissions: user can only read own submissions', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(user1Id, user2Id)
  createdBountyIds.push(bountyId)

  // Create submissions for both users
  await createTestSubmission(svc, user1Id, bountyId)
  await createTestSubmission(svc, user2Id, bountyId)

  const client = await authClient(user1Id)
  const { data } = await client
    .from('critterverse.submissions')
    .select('id, user_id')

  for (const row of (data ?? [])) {
    assertEq(row.user_id, user1Id, 'RLS must filter submissions to own user_id only')
  }
})


Deno.test('RLS submissions: user cannot spoof user_id on INSERT', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(user1Id, user2Id)
  createdBountyIds.push(bountyId)

  // user1 tries to submit as user2
  const client = await authClient(user1Id)
  const { error } = await client
    .from('critterverse.submissions')
    .insert({ user_id: user2Id, bounty_id: bountyId, submitted_lat: 37.0, submitted_lng: -122.0 })

  assert(error !== null, 'RLS WITH CHECK must block submission with spoofed user_id')
})


// ─────────────────────────────────────────────────────────────
// COUNCIL VOTES — BLIND VOTING WINDOW
// ─────────────────────────────────────────────────────────────

Deno.test('RLS council_votes: voter cannot see other voters\' commitments before deadline', async () => {
  const svc      = svcClient()
  const voter1Id = await createTestUser(svc, { archivist_eligible: true })
  const voter2Id = await createTestUser(svc, { archivist_eligible: true })
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(voter1Id, voter2Id, submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })

  const { data: archItem } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.30, archive_status: 'pending_review' })
    .select('id').single()

  // Voting deadline in the FUTURE — blind phase is active
  const futureDeadline = new Date(Date.now() + 48 * 3_600_000).toISOString()
  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archItem!.id,
      session_status:  'active',
      voting_deadline: futureDeadline,
      reveal_deadline: new Date(Date.now() + 72 * 3_600_000).toISOString()
    })
    .select('id').single()

  // Insert voter2's commitment via service_role (bypassing client RLS)
  await svc.from('critterverse.council_votes').insert({
    session_id:           session!.id,
    voter_user_id:        voter2Id,
    vote_commitment_hash: 'secret_hash_voter2',
    stake_amount:         20.0,
    stake_locked_at:      new Date().toISOString()
  })

  // voter1 tries to read voter2's commitment — should be blocked (deadline not passed)
  const client = await authClient(voter1Id)
  const { data: seen } = await client
    .from('critterverse.council_votes')
    .select('id, voter_user_id, vote_commitment_hash')
    .eq('session_id', session!.id)
    .eq('voter_user_id', voter2Id)

  assertEq(
    (seen?.length ?? 0), 0,
    'voter1 must not be able to see voter2\'s commitment during active voting window'
  )
})


// ─────────────────────────────────────────────────────────────
// PATCHWORK_BRIDGE SCHEMA — COMPLETE ISOLATION
// ─────────────────────────────────────────────────────────────

Deno.test('RLS patchwork_bridge: authenticated user cannot read webhook_ingestion', async () => {
  const svc    = svcClient()
  const userId = await createTestUser(svc)
  createdUserIds.push(userId)

  const client = await authClient(userId)
  const { data, error } = await client
    .from('patchwork_bridge.webhook_ingestion')
    .select('id')
    .limit(1)

  // Must return either an error or zero rows
  const isBlocked = error !== null || (data?.length ?? 0) === 0
  assert(isBlocked, 'authenticated user must not access patchwork_bridge.webhook_ingestion')
})


Deno.test('RLS patchwork_bridge: anon user cannot read webhook_ingestion', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anonClient
    .from('patchwork_bridge.webhook_ingestion')
    .select('id')
    .limit(1)

  const isBlocked = error !== null || (data?.length ?? 0) === 0
  assert(isBlocked, 'anon user must not access patchwork_bridge.webhook_ingestion')
})


Deno.test('RLS patchwork_bridge: anon user cannot read outbound_pings', async () => {
  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anonClient
    .from('patchwork_bridge.outbound_pings')
    .select('id')
    .limit(1)

  const isBlocked = error !== null || (data?.length ?? 0) === 0
  assert(isBlocked, 'anon user must not access patchwork_bridge.outbound_pings')
})


// ─────────────────────────────────────────────────────────────
// PIPELINE EVENTS — AUDIT TRAIL SCOPING
// ─────────────────────────────────────────────────────────────

Deno.test('RLS pipeline_events: user can only read events for own submissions', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(user1Id, user2Id)
  createdBountyIds.push(bountyId)

  const sub1Id = await createTestSubmission(svc, user1Id, bountyId)
  const sub2Id = await createTestSubmission(svc, user2Id, bountyId)

  // Insert pipeline events for both submissions
  await svc.from('critterverse.pipeline_events').insert([
    { submission_id: sub1Id, event_type: 'submission.initiated', event_data: {} },
    { submission_id: sub2Id, event_type: 'submission.initiated', event_data: {} }
  ])

  const client = await authClient(user1Id)
  const { data } = await client
    .from('critterverse.pipeline_events')
    .select('id, submission_id')

  // All returned pipeline events must reference user1's submissions only
  for (const row of (data ?? [])) {
    assertEq(
      row.submission_id, sub1Id,
      'RLS must only return pipeline events for own submissions'
    )
  }
})


// ─────────────────────────────────────────────────────────────
// CROSS-APP UNLOCKS SCOPING
// ─────────────────────────────────────────────────────────────

Deno.test('RLS cross_app_unlocks: user can only read own unlocks', async () => {
  const svc      = svcClient()
  const user1Id  = await createTestUser(svc)
  const user2Id  = await createTestUser(svc)
  createdUserIds.push(user1Id, user2Id)

  await svc.from('critterverse.cross_app_unlocks').insert([
    { user_id: user1Id, unlock_type: 'trust_score_bonus', trigger_source: 'patchwork_accuracy' },
    { user_id: user2Id, unlock_type: 'archivist_status',  trigger_source: 'patchwork_accuracy' }
  ])

  const client = await authClient(user1Id)
  const { data } = await client
    .from('critterverse.cross_app_unlocks')
    .select('id, user_id')

  for (const row of (data ?? [])) {
    assertEq(row.user_id, user1Id, 'user1 must only see their own unlocks')
  }
})


// ─────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────

Deno.test({
  name: 'RLS: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
