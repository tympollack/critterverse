/**
 * tests/setup.ts
 * Shared test infrastructure. Requires a local Supabase instance:
 *   supabase start
 *
 * Set environment variables before running:
 *   export SUPABASE_URL=http://localhost:54321
 *   export SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
 *   export TRUST_CHAIN_GENESIS_HASH=a3f8c2d1e9b047561a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4
 *
 * Run: deno test tests/ --allow-net --allow-env
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

export const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')           ?? 'http://localhost:54321'
export const SUPABASE_SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
export const GENESIS_HASH           = Deno.env.get('TRUST_CHAIN_GENESIS_HASH')  ??
  'a3f8c2d1e9b047561a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4'
export const INTERNAL_KEY           = Deno.env.get('INTERNAL_FUNCTION_KEY')  ?? 'test-internal-key'
export const PATCHWORK_WEBHOOK_SEC  = Deno.env.get('PATCHWORK_WEBHOOK_SECRET') ?? 'test-pw-secret'

/** Service-role client — bypasses RLS */
export function svcClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  })
}

export const fnUrl = (path: string) => `${SUPABASE_URL}/functions/v1/${path}`

/** Standard internal headers for Edge Function calls */
export const internalHeaders = {
  'Content-Type': 'application/json',
  'X-Internal-Key': INTERNAL_KEY
}

// ── Seed helpers ─────────────────────────────────────────────

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Creates a test user directly via the DB (bypasses bootstrap Edge Function).
 * Returns the created user's ID.
 */
export async function createTestUser(svc: SupabaseClient, overrides: Record<string, unknown> = {}): Promise<string> {
  const nodeHash = await sha256Hex(`test-user-${Date.now()}-${Math.random()}`)
  const path     = `root.test_branch.${nodeHash.slice(0, 8)}`

  const { data, error } = await svc
    .from('critterverse.users')
    .insert({
      sunshade_node_hash: nodeHash,
      sunshade_path:      path,
      trust_score:        1.0,
      trust_state:        'active',
      reputation_balance: 100.0,
      archivist_eligible: false,
      ...overrides
    })
    .select('id')
    .single()

  if (error) throw new Error(`createTestUser failed: ${error.message}`)

  // Establish genesis trust chain
  const eventData   = { reason: 'test_registration', sunshade_node_hash: nodeHash }
  const currentHash = await sha256Hex(GENESIS_HASH + JSON.stringify(eventData))

  await svc.from('critterverse.trust_events').insert({
    user_id:       data.id,
    previous_hash: GENESIS_HASH,
    current_hash:  currentHash,
    event_type:    'trust.established',
    event_data:    eventData
  })

  return data.id
}

/**
 * Creates a test bounty.
 */
export async function createTestBounty(svc: SupabaseClient, overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('critterverse.bounties')
    .insert({
      geo_lat:          37.7749,
      geo_lng:          -122.4194,
      bounty_type:      'standard',
      source:           'admin_seeded',
      alpha_label:      'Test Cavern Entrance',
      reward_multiplier: 1.0,
      is_active:        true,
      ...overrides
    })
    .select('id')
    .single()

  if (error) throw new Error(`createTestBounty failed: ${error.message}`)
  return data.id
}

/**
 * Creates a test submission in a given status.
 */
export async function createTestSubmission(
  svc:      SupabaseClient,
  userId:   string,
  bountyId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await svc
    .from('critterverse.submissions')
    .insert({
      user_id:       userId,
      bounty_id:     bountyId,
      status:        'initiated',
      submitted_lat: 37.7749,
      submitted_lng: -122.4194,
      ...overrides
    })
    .select('id')
    .single()

  if (error) throw new Error(`createTestSubmission failed: ${error.message}`)
  return data.id
}

/**
 * Tears down all test data created in a test run.
 * Uses DELETE cascade — safe because test rows are identified by a prefix.
 */
export async function cleanupTestData(svc: SupabaseClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return

  // Order matters: FK dependencies
  await svc.from('critterverse.council_votes').delete()
    .in('voter_user_id', userIds)
  await svc.from('critterverse.council_voter_selection').delete()
    .in('voter_user_id', userIds)
  await svc.from('critterverse.pedometer_bounds').delete()
    .in('submission_id', (await svc
      .from('critterverse.submissions')
      .select('id')
      .in('user_id', userIds)).data?.map((r: { id: string }) => r.id) ?? [])
  await svc.from('critterverse.pipeline_events').delete()
    .in('submission_id', (await svc
      .from('critterverse.submissions')
      .select('id')
      .in('user_id', userIds)).data?.map((r: { id: string }) => r.id) ?? [])
  await svc.from('critterverse.anomalous_archive_queue').delete()
    .in('submission_id', (await svc
      .from('critterverse.submissions')
      .select('id')
      .in('user_id', userIds)).data?.map((r: { id: string }) => r.id) ?? [])
  await svc.from('critterverse.submissions').delete().in('user_id', userIds)
  await svc.from('critterverse.trust_events').delete().in('user_id', userIds)
  await svc.from('critterverse.cross_app_unlocks').delete().in('user_id', userIds)
  await svc.from('critterverse.cross_app_identity_links').delete().in('user_id', userIds)
  await svc.from('critterverse.user_critters').delete().in('user_id', userIds)
  await svc.from('critterverse.users').delete().in('id', userIds)
}

/** Simple assertion helper */
export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

export function assertDefined<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${label}: expected defined value, got ${value}`)
  }
  return value
}
