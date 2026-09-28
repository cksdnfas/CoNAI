export type QueuedExecutionMetadata = {
  inputValues?: Record<string, unknown>
  targetNodeId?: string
  forceRerun?: boolean
  /** 최종 결과를 넣을 기본 이미지 그룹(대기 중에도 DB 행에 남아 재시작 복구된다) */
  outputGroupId?: number | null
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
    outputGroupId: job.outputGroupId ?? undefined,
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
