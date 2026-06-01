export type QueuedExecutionMetadata = {
  inputValues?: Record<string, unknown>
  targetNodeId?: string
  forceRerun?: boolean
}

const QUEUED_EXECUTION_METADATA_KIND = 'graph_execution_queue_job'

type PersistedQueuedExecutionMetadata = QueuedExecutionMetadata & {
  kind: typeof QUEUED_EXECUTION_METADATA_KIND
}

export function encodeQueuedExecutionMetadata(job: QueuedExecutionMetadata) {
  return JSON.stringify({
    kind: QUEUED_EXECUTION_METADATA_KIND,
    inputValues: job.inputValues,
    targetNodeId: job.targetNodeId,
    forceRerun: job.forceRerun,
  } satisfies PersistedQueuedExecutionMetadata)
}

export function parseQueuedExecutionMetadata(value?: string | null): QueuedExecutionMetadata {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as Partial<PersistedQueuedExecutionMetadata>
    return parsed.kind === QUEUED_EXECUTION_METADATA_KIND ? parsed : {}
  } catch {
    return {}
  }
}
