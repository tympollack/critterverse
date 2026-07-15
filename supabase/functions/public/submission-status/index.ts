/**
 * public/submission-status
 * Authenticated polling endpoint. The mobile client calls this
 * after initiating a submission to track it through the pipeline.
 *
 * Returns the submission's current state, all pipeline events
 * in order, pedometer outcome, and — if anomalous — the Council
 * session status. Includes narrative text for each state so the
 * mobile layer can render the alpha Subterranean Scavenger copy
 * without embedding pipeline logic in the client.
 *
 * Auth: SunShade JWT
 * RLS: users can only query their own submissions (enforced by
 *      the submissions SELECT policy; no extra check needed here)
 */

import { requireAuth, userClient, serviceClient } from '../_shared/clients.ts'

// Alpha narrative copy per pipeline state
const NARRATIVE: Record<string, { title: string; body: string }> = {
  initiated: {
    title: 'Survey Team Deployed',
    body:  'Your Survey Team has marked the location. Authentication is beginning.'
  },
  zkp_pending: {
    title: 'Authenticating Location',
    body:  'The cryptographic location seal is being verified. Stand by.'
  },
  zkp_invalid: {
    title: 'Location Seal Failed',
    body:  'Your Survey Team could not confirm the location. The submission has been rejected.'
  },
  hashing: {
    title: 'Analysing Artefact',
    body:  'The Elder Archivists\' scanners are classifying your find.'
  },
  verified: {
    title: 'Cavern Entrance Logged',
    body:  'Your Survey Team\'s report has been confirmed and filed. Rewards have been credited.'
  },
  rejected: {
    title: 'Submission Rejected',
    body:  'The report could not be verified. No rewards have been issued.'
  },
  anomalous: {
    title: 'Unidentified Artefact Flagged',
    body:  'Your find defies classification. The Elder Scavengers have been summoned to convene a Relic Tribunal.'
  }
}

const COUNCIL_NARRATIVE: Record<string, string> = {
  selecting_voters:  'The Relic Tribunal is assembling its Elder Scavengers.',
  active:            'The Tribunal is in session. Verdicts are being cast in secret.',
  reveal_phase:      'The seals have broken. Verdicts are being revealed.',
  completed:         'The Tribunal has reached a verdict.',
  no_consensus:      'The Tribunal could not reach consensus. The case will be re-examined.',
  appealed:          'The verdict is under appeal.'
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 })
  }

  let userId: string
  try {
    ;({ userId } = await requireAuth(req))
  } catch (res) {
    return res as Response
  }

  const url          = new URL(req.url)
  const submissionId = url.searchParams.get('submission_id')

  if (!submissionId) {
    return new Response(JSON.stringify({ error: 'missing_submission_id' }), { status: 400 })
  }

  // user-JWT context: RLS enforces user_id = auth.uid() on submissions
  const client = userClient(req)

  const { data: sub, error: subErr } = await client
    .from('critterverse.submissions')
    .select(`
      id, status,
      bounty_id,
      ai_confidence, ai_classification,
      is_offline_submission, offline_synced_at,
      reward_multiplier, reward_amount, reward_paid_at,
      created_at, processed_at,
      zkp_validated_at
    `)
    .eq('id', submissionId)
    .single()

  if (subErr || !sub) {
    // RLS returns nothing (not an error) for submissions not owned by the caller
    return new Response(JSON.stringify({ error: 'submission_not_found' }), { status: 404 })
  }

  // service_role for reads that cross RLS boundaries (pipeline events, archive, council)
  const svc = serviceClient()

  // ── Pipeline event trail ──────────────────────────────────
  const { data: events } = await svc
    .rpc('critterverse.get_submission_pipeline_summary', { p_submission_id: submissionId })

  // ── Pedometer outcome ─────────────────────────────────────
  const { data: pedo } = await svc
    .from('critterverse.pedometer_bounds')
    .select('expected_steps, min_steps_allowed, max_steps_allowed, reported_steps, is_over_achiever_trap, trap_penalty_bounty_id')
    .eq('submission_id', submissionId)
    .maybeSingle()

  // ── Bounty details ────────────────────────────────────────
  const { data: bounty } = await svc
    .from('critterverse.bounties')
    .select('alpha_label, bounty_type, reward_multiplier')
    .eq('id', sub.bounty_id)
    .single()

  // ── Anomalous / Council info ──────────────────────────────
  let councilStatus: Record<string, unknown> | null = null

  if (sub.status === 'anomalous') {
    const { data: archive } = await svc
      .from('critterverse.anomalous_archive_queue')
      .select('archive_status, confidence_band, council_session_id')
      .eq('submission_id', submissionId)
      .maybeSingle()

    if (archive?.council_session_id) {
      const { data: session } = await svc
        .from('critterverse.council_sessions')
        .select('session_status, consensus_result, voting_deadline, reveal_deadline, resolved_at')
        .eq('id', archive.council_session_id)
        .single()

      councilStatus = {
        session_id:        archive.council_session_id,
        session_status:    session?.session_status,
        consensus_result:  session?.consensus_result ?? null,
        voting_deadline:   session?.voting_deadline  ?? null,
        reveal_deadline:   session?.reveal_deadline  ?? null,
        resolved_at:       session?.resolved_at      ?? null,
        archive_status:    archive.archive_status,
        confidence_band:   archive.confidence_band,
        narrative:         COUNCIL_NARRATIVE[session?.session_status ?? ''] ?? null
      }
    } else {
      councilStatus = {
        session_status: 'pending_assembly',
        archive_status: archive?.archive_status ?? 'pending_review',
        narrative: 'The Elder Scavengers are being summoned.'
      }
    }
  }

  // ── Critter drop outcome ──────────────────────────────────
  let critterDrop: Record<string, unknown> | null = null
  if (sub.status === 'verified') {
    const { data: critter } = await svc
      .from('critterverse.user_critters')
      .select('species_id, minted_at, critterverse.critter_species(species_name, rarity_tier)')
      .eq('source_submission', submissionId)
      .maybeSingle()

    if (critter) {
      const species = (critter as Record<string, unknown>)['critterverse.critter_species'] as Record<string, string> | null
      critterDrop = {
        species_id:   critter.species_id,
        species_name: species?.species_name ?? null,
        rarity_tier:  species?.rarity_tier  ?? null,
        minted_at:    critter.minted_at
      }
    }
  }

  // ── Over-Achiever Trap narrative ──────────────────────────
  let trapInfo: Record<string, unknown> | null = null
  if (pedo?.is_over_achiever_trap) {
    const { data: penaltyBounty } = pedo.trap_penalty_bounty_id
      ? await svc
          .from('critterverse.bounties')
          .select('id, alpha_label, geo_lat, geo_lng')
          .eq('id', pedo.trap_penalty_bounty_id)
          .single()
      : { data: null }

    trapInfo = {
      triggered:      true,
      penalty_bounty: penaltyBounty ?? null,
      narrative:      'Anomalous step count detected. Your Survey Team has been redirected to a mandatory secondary site before rewards can be released.'
    }
  }

  // ── Compute progress for in-flight submissions ─────────────
  const PIPELINE_STAGES = [
    'submission.initiated',
    'zkp.validation_started',
    'zkp.status',
    'hashing.processed',
    'storage.purged'
  ]
  const completedStages  = new Set((events ?? []).map((e: { event_type: string }) => e.event_type))
  const progressPct      = Math.round(
    (PIPELINE_STAGES.filter(s => completedStages.has(s)).length / PIPELINE_STAGES.length) * 100
  )

  const narrative = NARRATIVE[sub.status] ?? { title: 'Unknown State', body: '' }

  return new Response(
    JSON.stringify({
      submission_id:   submissionId,
      status:          sub.status,
      progress_pct:    progressPct,
      narrative,
      bounty: {
        id:           sub.bounty_id,
        alpha_label:  bounty?.alpha_label  ?? null,
        bounty_type:  bounty?.bounty_type  ?? null
      },
      pipeline_events:     events ?? [],
      pedometer:           pedo   ?? null,
      over_achiever_trap:  trapInfo,
      council:             councilStatus,
      reward: sub.status === 'verified' ? {
        multiplier:  sub.reward_multiplier,
        amount:      sub.reward_amount,
        paid_at:     sub.reward_paid_at
      } : null,
      critter_drop:        critterDrop,
      is_offline:          sub.is_offline_submission,
      offline_synced_at:   sub.offline_synced_at ?? null,
      created_at:          sub.created_at,
      processed_at:        sub.processed_at ?? null
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Short cache: in-flight submissions change state quickly
        'Cache-Control': sub.status === 'verified' || sub.status === 'rejected'
          ? 'private, max-age=300'   // terminal states: 5 min
          : 'private, max-age=5'     // in-flight: 5 sec
      }
    }
  )
})
