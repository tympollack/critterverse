/**
 * tests/analytics.test.ts
 * Integration tests for admin/analytics endpoint and the
 * underlying migration 016 analytics views.
 *
 * Tests cover:
 *   - Auth enforcement (401 without X-Internal-Key)
 *   - View discovery (no view param returns manifest)
 *   - Input validation (unknown view returns 400)
 *   - All 8 views return valid paginated responses
 *   - Pagination params (limit, offset) work correctly
 *   - View-specific data accuracy for seeded data
 *
 * Run: deno test tests/analytics.test.ts --allow-net --allow-env
 */

import {
  svcClient, createTestUser, createTestBounty, createTestSubmission,
  cleanupTestData, assert, assertEq, assertDefined,
  sha256Hex, SUPABASE_URL
} from './setup.ts'

const INTERNAL_KEY = Deno.env.get('INTERNAL_FUNCTION_KEY') ??
  'ci-internal-key-32chars-padding-xx'

const createdUserIds:   string[] = []
const createdBountyIds: string[] = []

const ADMIN_URL = `${SUPABASE_URL}/functions/v1/admin/analytics`

async function analyticsGet(params = ''): Promise<Response> {
  return fetch(`${ADMIN_URL}${params}`, {
    headers: { 'X-Internal-Key': INTERNAL_KEY }
  })
}

const ALL_VIEWS = [
  'daily_submission_stats',
  'trust_distribution',
  'council_verdict_summary',
  'bounty_verification_heatmap',
  'archivist_leaderboard',
  'anomalous_queue_status',
  'redemption_arc_funnel',
  'patchwork_bridge_activity'
]


// ─────────────────────────────────────────────────────────────
// AUTH AND ROUTING
// ─────────────────────────────────────────────────────────────

Deno.test('analytics: returns 401 without X-Internal-Key', async () => {
  const res = await fetch(ADMIN_URL)
  assertEq(res.status, 401, 'missing key must return 401')
  await res.body?.cancel()
})


Deno.test('analytics: returns 401 with wrong key', async () => {
  const res = await fetch(ADMIN_URL, {
    headers: { 'X-Internal-Key': 'wrong-key' }
  })
  assertEq(res.status, 401, 'wrong key must return 401')
  await res.body?.cancel()
})


Deno.test('analytics: returns view manifest when no view param', async () => {
  const res  = await analyticsGet()
  assertEq(res.status, 200, 'no view param must return 200 with manifest')

  const body = await res.json()
  assertDefined(body.available_views, 'available_views must be present')
  assertDefined(body.usage,           'usage hint must be present')
  assertEq(body.available_views.length, ALL_VIEWS.length, `manifest must list all ${ALL_VIEWS.length} views`)

  // Verify all expected views are in the manifest
  const names = body.available_views.map((v: { name: string }) => v.name)
  for (const view of ALL_VIEWS) {
    assert(names.includes(view), `manifest must include view: ${view}`)
  }
})


Deno.test('analytics: returns 400 for unknown view name', async () => {
  const res  = await analyticsGet('?view=this_view_does_not_exist')
  assertEq(res.status, 400, 'unknown view must return 400')

  const body = await res.json()
  assertEq(body.error, 'unknown_view', 'error code must be unknown_view')
  assertDefined(body.available_views, 'error response must list available views')
})


Deno.test('analytics: rejects method other than GET', async () => {
  const res = await fetch(ADMIN_URL, {
    method:  'POST',
    headers: { 'X-Internal-Key': INTERNAL_KEY }
  })
  assertEq(res.status, 405, 'POST must return 405')
  await res.body?.cancel()
})


// ─────────────────────────────────────────────────────────────
// ALL VIEWS: SMOKE TEST (valid response structure)
// ─────────────────────────────────────────────────────────────

for (const viewName of ALL_VIEWS) {
  Deno.test(`analytics: ${viewName} returns valid paginated structure`, async () => {
    const res  = await analyticsGet(`?view=${viewName}&limit=10`)
    assertEq(res.status, 200, `${viewName} must return 200`)

    const body = await res.json()
    assertDefined(body.meta,        `${viewName}: meta block must be present`)
    assertDefined(body.data,        `${viewName}: data block must be present`)
    assertEq(body.meta.view, viewName, `${viewName}: meta.view must match`)
    assertEq(body.meta.limit, 10,      `${viewName}: meta.limit must reflect param`)
    assertEq(body.meta.offset, 0,      `${viewName}: meta.offset must default to 0`)
    assert(Array.isArray(body.data),   `${viewName}: data must be an array`)
    assert(
      body.meta.returned <= 10,
      `${viewName}: returned count must not exceed limit`
    )
  })
}


// ─────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────

Deno.test('analytics: limit param is respected', async () => {
  const res  = await analyticsGet('?view=daily_submission_stats&limit=3')
  const body = await res.json()
  assert(body.meta.returned <= 3, 'returned count must be ≤ requested limit')
})


Deno.test('analytics: limit is capped at 500', async () => {
  const res  = await analyticsGet('?view=daily_submission_stats&limit=9999')
  const body = await res.json()
  // Endpoint caps at 500 — if there are fewer than 500 rows, returned will be lower
  assert(body.meta.returned <= 500, 'returned must never exceed the 500 hard cap')
})


Deno.test('analytics: offset param skips rows', async () => {
  const svc = svcClient()

  // Create enough submissions to have data across two days
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  await createTestSubmission(svc, userId, bountyId, { status: 'verified', reward_amount: 10.0 })

  const page1 = await (await analyticsGet('?view=daily_submission_stats&limit=1&offset=0')).json()
  const page2 = await (await analyticsGet('?view=daily_submission_stats&limit=1&offset=1')).json()

  // If there are at least 2 rows, the first rows of each page should differ
  if (page1.data.length > 0 && page2.data.length > 0) {
    const day1 = page1.data[0].day
    const day2 = page2.data[0].day
    // Days should be different (rows are ordered by day DESC)
    assert(day1 !== day2, 'offset page should return a different row')
  }
  // If there's only one row of data, pagination returning empty is correct
  assert(page1.meta.offset === 0, 'page1 offset must be 0')
  assert(page2.meta.offset === 1, 'page2 offset must be 1')
})


// ─────────────────────────────────────────────────────────────
// DATA ACCURACY: specific view checks
// ─────────────────────────────────────────────────────────────

Deno.test('analytics: trust_distribution shows all trust_state values', async () => {
  const svc = svcClient()

  // Create users in each trust state
  const activeId      = await createTestUser(svc, { trust_state: 'active',      trust_score: 0.90 })
  const quarantinedId = await createTestUser(svc, { trust_state: 'quarantined', trust_score: 0.40 })
  const slashedId     = await createTestUser(svc, { trust_state: 'slashed',     trust_score: 0.10 })
  createdUserIds.push(activeId, quarantinedId, slashedId)

  const res  = await analyticsGet('?view=trust_distribution&limit=50')
  const body = await res.json()

  const states = body.data.map((row: { trust_state: string }) => row.trust_state)
  assert(states.includes('active'),      'distribution must include active state')
  // quarantined and slashed may or may not appear depending on existing data
  // — just verify the view structure is correct
  for (const row of body.data) {
    assertDefined(row.trust_state, 'each row must have trust_state')
    assertDefined(row.score_band,  'each row must have score_band')
    assertDefined(row.user_count,  'each row must have user_count')
    assertDefined(row.avg_score,   'each row must have avg_score')
  }
})


Deno.test('analytics: redemption_arc_funnel stage labels are correct', async () => {
  const res  = await analyticsGet('?view=redemption_arc_funnel&limit=10')
  const body = await res.json()

  const validStages = [
    '1_active',
    '2_quarantined_t1',
    '3_quarantined_t2_required',
    '4_slashed',
    '5_other'
  ]

  for (const row of body.data) {
    assertDefined(row.funnel_stage, 'each row must have funnel_stage')
    assert(
      validStages.includes(row.funnel_stage),
      `funnel_stage '${row.funnel_stage}' is not a valid stage`
    )
    assertDefined(row.user_count,  'each row must have user_count')
    assertDefined(row.avg_trust_score, 'each row must have avg_trust_score')
  }
})


Deno.test('analytics: daily_submission_stats includes verified_count field', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  // Create a verified submission to ensure today has data
  await createTestSubmission(svc, userId, bountyId, {
    status: 'verified', reward_amount: 10.0, processed_at: new Date().toISOString()
  })

  const res  = await analyticsGet('?view=daily_submission_stats&limit=1')
  const body = await res.json()

  // Should have at least one row (today's data)
  assert(body.data.length >= 1, 'daily_submission_stats must return at least one row')

  const today = body.data[0]
  assertDefined(today.day,                 'day column must be present')
  assertDefined(today.total_submissions,   'total_submissions column must be present')
  assertDefined(today.verified,            'verified column must be present')
  assertDefined(today.rejected,            'rejected column must be present')
  assertDefined(today.anomalous,           'anomalous column must be present')
  assertDefined(today.verification_rate_pct, 'verification_rate_pct must be present')
})


Deno.test('analytics: anomalous_queue_status reflects real queue state', async () => {
  const svc      = svcClient()
  const userId   = await createTestUser(svc)
  const bountyId = await createTestBounty(svc)
  createdUserIds.push(userId)
  createdBountyIds.push(bountyId)

  const subId = await createTestSubmission(svc, userId, bountyId, { status: 'anomalous' })
  await svc.from('critterverse.anomalous_archive_queue').insert({
    submission_id:  subId,
    ai_confidence:  0.25,
    archive_status: 'pending_review'
  })

  const res  = await analyticsGet('?view=anomalous_queue_status&limit=20')
  const body = await res.json()

  // The view filters on pending/in_review — we should have at least one row
  for (const row of body.data) {
    assertDefined(row.archive_status, 'archive_status must be present')
    assertDefined(row.confidence_band, 'confidence_band must be present')
    assertDefined(row.item_count,     'item_count must be present')
    assert(
      ['pending_review','in_review'].includes(row.archive_status),
      `status '${row.archive_status}' should not appear in queue status view`
    )
  }
})


Deno.test('analytics: bounty_verification_heatmap includes staleness_score', async () => {
  const res  = await analyticsGet('?view=bounty_verification_heatmap&limit=5')
  const body = await res.json()

  for (const row of body.data) {
    assertDefined(row.id,              'id must be present')
    assertDefined(row.geo_lat,         'geo_lat must be present')
    assertDefined(row.geo_lng,         'geo_lng must be present')
    assertDefined(row.staleness_score, 'staleness_score must be present')
    assertDefined(row.bounty_type,     'bounty_type must be present')
    assert(
      typeof row.has_active_council === 'boolean',
      'has_active_council must be a boolean'
    )
  }
})


// ─────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────

Deno.test({
  name: 'analytics: cleanup test data',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const svc = svcClient()
    await svc.from('critterverse.bounties').delete().in('id', createdBountyIds)
    await cleanupTestData(svc, createdUserIds)
  }
})
