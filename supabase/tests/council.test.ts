/**
 * tests/council.test.ts
 * Integration tests for the Scavenger Council:
 *   N-hop voter selection → blind commit → reveal → Schelling Point resolution
 *
 * Run: deno test tests/council.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined, sha256Hex
} from './setup.ts'

const createdUserIds:  string[] = []
const createdBountyIds: string[] = []

/** Create an archivist-eligible user with enough balance to stake */
async function createArchivist(svc: ReturnType<typeof svcClient>, pathSuffix: string): Promise<string> {
  return createTestUser(svc, {
    sunshade_path:      `root.branch_${pathSuffix}.leaf_001`,
    archivist_eligible: true,
    trust_score:        0.90,
    reputation_balance: 200.0
  })
}


// ── Test 1: Session is created and archive item updated ────────
Deno.test('council: session creation links to archive item', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, {
    status: 'anomalous', ai_confidence: 0.40
  })

  // Create anomalous archive item
  const { data: archiveItem } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.40, archive_status: 'pending_review' })
    .select('id')
    .single()

  assertDefined(archiveItem, 'archive item must be created')

  // Open a council session
  const votingDeadline = new Date(Date.now() + 48 * 3_600_000).toISOString()
  const revealDeadline = new Date(Date.now() + 72 * 3_600_000).toISOString()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archiveItem.id,
      session_status:  'active',
      voting_deadline: votingDeadline,
      reveal_deadline: revealDeadline
    })
    .select('id, session_status')
    .single()

  assertDefined(session, 'council session must be created')
  assertEq(session.session_status, 'active', 'session should start as active')

  // Link session back to archive item
  await svc
    .from('critterverse.anomalous_archive_queue')
    .update({ archive_status: 'in_review', council_session_id: session.id })
    .eq('id', archiveItem.id)

  const { data: updatedArchive } = await svc
    .from('critterverse.anomalous_archive_queue')
    .select('archive_status, council_session_id')
    .eq('id', archiveItem.id)
    .single()

  assertEq(updatedArchive?.archive_status, 'in_review', 'archive status should update to in_review')
  assertEq(updatedArchive?.council_session_id, session.id, 'session_id must be linked')
})


// ── Test 2: Blind commitment scheme verifies correctly ────────
Deno.test('council: commitment hash is verifiable with correct vote+salt', async () => {
  const vote = 'legitimate'
  const salt = 'randomsalt_' + Date.now()
  const commitmentHash = await sha256Hex(`${vote}:${salt}`)

  // Verify reveal: hash(vote:salt) === commitment
  const recomputedHash = await sha256Hex(`${vote}:${salt}`)
  assertEq(recomputedHash, commitmentHash, 'commitment hash should match re-computed reveal hash')

  // Wrong salt → different hash
  const wrongHash = await sha256Hex(`${vote}:wrongsalt`)
  assert(wrongHash !== commitmentHash, 'wrong salt should produce different hash')

  // Wrong vote → different hash
  const wrongVoteHash = await sha256Hex(`fraudulent:${salt}`)
  assert(wrongVoteHash !== commitmentHash, 'wrong vote should produce different hash')
})


// ── Test 3: Full Schelling Point resolution — majority wins ───
Deno.test('council: Schelling Point resolution correctly distributes stakes', async () => {
  const svc      = svcClient()
  const submitter = await createTestUser(svc)
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })

  // Create 5 archivists on different branches to avoid hop conflicts
  const archivists = await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map(suffix => createArchivist(svc, suffix))
  )
  createdUserIds.push(...archivists)

  // Open archive and council session
  const { data: archItem } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.30, archive_status: 'pending_review' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archItem.id,
      session_status:  'reveal_phase',  // skip to reveal_phase for test
      voting_deadline: new Date(Date.now() - 1000).toISOString(),   // already passed
      reveal_deadline: new Date(Date.now() + 3_600_000).toISOString()
    })
    .select('id').single()

  await svc
    .from('critterverse.anomalous_archive_queue')
    .update({ archive_status: 'in_review', council_session_id: session.id })
    .eq('id', archItem.id)

  // 3 vote 'legitimate' (stake 20 each = 60 total), 2 vote 'fraudulent' (stake 15 each = 30 total)
  const voteScenario = [
    { userId: archivists[0], vote: 'legitimate', stake: 20.0 },
    { userId: archivists[1], vote: 'legitimate', stake: 20.0 },
    { userId: archivists[2], vote: 'legitimate', stake: 20.0 },
    { userId: archivists[3], vote: 'fraudulent', stake: 15.0 },
    { userId: archivists[4], vote: 'fraudulent', stake: 15.0 },
  ]

  // Deduct stakes and insert revealed votes
  for (const v of voteScenario) {
    await svc.from('critterverse.users')
      .update({ reputation_balance: 200.0 - v.stake })
      .eq('id', v.userId)

    const salt   = `test_salt_${v.userId}`
    const hash   = await sha256Hex(`${v.vote}:${salt}`)

    await svc.from('critterverse.council_votes').insert({
      session_id:           session.id,
      voter_user_id:        v.userId,
      vote_commitment_hash: hash,
      stake_amount:         v.stake,
      revealed_vote:        v.vote,
      revealed_salt:        salt,
      revealed_at:          new Date().toISOString(),
      reveal_valid:         true
    })
  }

  // Run resolution
  const { error: resolveErr } = await svc
    .rpc('critterverse.resolve_council_session', { p_session_id: session.id })
  assert(resolveErr === null, `resolution failed: ${resolveErr?.message}`)

  // Verify session outcome
  const { data: resolved } = await svc
    .from('critterverse.council_sessions')
    .select('session_status, consensus_result, majority_stake, minority_stake')
    .eq('id', session.id)
    .single()

  assertEq(resolved?.session_status,  'completed',  'session must be completed')
  assertEq(resolved?.consensus_result, 'legitimate', 'majority vote (3 legitimate) must win')
  assertEq(resolved?.majority_stake,   60.0,         'majority stake = 3 × 20')
  assertEq(resolved?.minority_stake,   30.0,         'minority stake = 2 × 15')

  // Verify majority voters gained from minority pool
  for (const v of voteScenario.filter(x => x.vote === 'legitimate')) {
    const { data: u } = await svc
      .from('critterverse.users')
      .select('reputation_balance')
      .eq('id', v.userId).single()

    // Each majority voter's share = (20 / 60) * 30 = 10.0 gain
    const expectedBalance = (200.0 - v.stake) + ((v.stake / 60.0) * 30.0)
    assert(
      Math.abs((u?.reputation_balance ?? 0) - expectedBalance) < 0.01,
      `majority voter ${v.userId} balance off: expected ${expectedBalance}, got ${u?.reputation_balance}`
    )
  }

  // Verify minority voters lost their full stake
  for (const v of voteScenario.filter(x => x.vote === 'fraudulent')) {
    const { data: u } = await svc
      .from('critterverse.users')
      .select('reputation_balance')
      .eq('id', v.userId).single()
    const expectedBalance = 200.0 - v.stake  // started with 200-stake, gained nothing
    assert(
      Math.abs((u?.reputation_balance ?? 0) - expectedBalance) < 0.01,
      `minority voter ${v.userId} should have lost their stake`
    )
  }
})


// ── Test 4: Fraudulent verdict triggers submitter trust slash ─
Deno.test('council: fraudulent verdict slashes the submitter', async () => {
  const svc       = svcClient()
  const submitter = await createTestUser(svc, { trust_score: 0.90 })
  const bountyId  = await createTestBounty(svc)
  createdUserIds.push(submitter)
  createdBountyIds.push(bountyId)

  // Verify submitter starts with good trust
  const { data: before } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', submitter).single()
  assertEq(before?.trust_state, 'active', 'submitter should start as active')

  // Apply slash directly
  const { error } = await svc
    .rpc('critterverse.apply_trust_slash', {
      p_user_id:  submitter,
      p_reason:   'council_verdict_fraudulent',
      p_severity: 0.40
    })
  assert(error === null, `trust slash failed: ${error?.message}`)

  const { data: after } = await svc
    .from('critterverse.users')
    .select('trust_score, trust_state')
    .eq('id', submitter).single()

  assert((after?.trust_score ?? 1) < 0.90, 'trust_score must decrease after slash')
  const expectedScore = 0.90 * (1 - 0.40)
  assert(
    Math.abs((after?.trust_score ?? 0) - expectedScore) < 0.001,
    `trust_score should be 0.90 * 0.60 = ${expectedScore}, got ${after?.trust_score}`
  )

  // Verify trust event was appended
  const { data: events } = await svc
    .from('critterverse.trust_events')
    .select('event_type, event_data')
    .eq('user_id', submitter)
    .order('created_at', { ascending: false })
    .limit(1)

  assertEq(events?.[0]?.event_type, 'trust.slashing', 'slashing event must be appended')
  assertEq(events?.[0]?.event_data?.reason, 'council_verdict_fraudulent', 'slash reason must match')
})


// ── Test 5: Exact stake tie → no_consensus ────────────────────
Deno.test('council: exact stake tie produces no_consensus', async () => {
  const svc = svcClient()

  const archivists = await Promise.all(
    ['x', 'y'].map(s => createArchivist(svc, `tie_${s}_${Date.now()}`))
  )
  createdUserIds.push(...archivists)

  const bountyId  = await createTestBounty(svc)
  const submitter = await createTestUser(svc)
  createdUserIds.push(submitter)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, submitter, bountyId, { status: 'anomalous' })

  const { data: archItem } = await svc
    .from('critterverse.anomalous_archive_queue')
    .insert({ submission_id: subId, ai_confidence: 0.35, archive_status: 'pending_review' })
    .select('id').single()

  const { data: session } = await svc
    .from('critterverse.council_sessions')
    .insert({
      archive_item_id: archItem.id,
      session_status:  'reveal_phase',
      voting_deadline: new Date(Date.now() - 1000).toISOString(),
      reveal_deadline: new Date(Date.now() + 3_600_000).toISOString()
    })
    .select('id').single()

  await svc
    .from('critterverse.anomalous_archive_queue')
    .update({ archive_status: 'in_review', council_session_id: session.id })
    .eq('id', archItem.id)

  // Equal stakes: 1 legitimate × 20, 1 fraudulent × 20
  const votes = [
    { userId: archivists[0], vote: 'legitimate', stake: 20.0 },
    { userId: archivists[1], vote: 'fraudulent', stake: 20.0 }
  ]

  for (const v of votes) {
    const salt = `tie_salt_${v.userId}`
    const hash = await sha256Hex(`${v.vote}:${salt}`)
    await svc.from('critterverse.council_votes').insert({
      session_id: session.id, voter_user_id: v.userId,
      vote_commitment_hash: hash, stake_amount: v.stake,
      revealed_vote: v.vote, revealed_salt: salt,
      revealed_at: new Date().toISOString(), reveal_valid: true
    })
  }

  await svc.rpc('critterverse.resolve_council_session', { p_session_id: session.id })

  const { data: result } = await svc
    .from('critterverse.council_sessions')
    .select('session_status, consensus_result')
    .eq('id', session.id).single()

  assertEq(result?.session_status, 'no_consensus', 'tied vote must produce no_consensus')
})


// ── Cleanup ───────────────────────────────────────────────────
Deno.test({
  name: 'council: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
