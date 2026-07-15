import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type PipelineEventType =
  | 'submission.initiated'
  | 'zkp.validation_started'
  | 'zkp.status'
  | 'hashing.processed'
  | 'storage.purged'
  | 'storage.anomalous_archived'

/**
 * Appends a typed event to critterverse.pipeline_events.
 * Always uses service_role — pipeline events are system-level writes.
 */
export async function logPipelineEvent(
  svc:           SupabaseClient,
  submissionId:  string,
  eventType:     PipelineEventType,
  eventData:     Record<string, unknown> = {}
): Promise<void> {
  const { error } = await svc
    .from('critterverse.pipeline_events')
    .insert({ submission_id: submissionId, event_type: eventType, event_data: eventData })

  if (error) {
    // Pipeline event logging failure is non-fatal but must be surfaced
    console.error(`[pipeline_logger] Failed to log ${eventType} for ${submissionId}:`, error)
  }
}

/**
 * Updates a submission's status field.
 * Always uses service_role.
 */
export async function updateSubmissionStatus(
  svc:          SupabaseClient,
  submissionId: string,
  status:       string,
  extra:        Record<string, unknown> = {}
): Promise<void> {
  const { error } = await svc
    .from('critterverse.submissions')
    .update({ status, processed_at: new Date().toISOString(), ...extra })
    .eq('id', submissionId)

  if (error) {
    console.error(`[pipeline_logger] Failed to update status for ${submissionId}:`, error)
    throw error
  }
}
