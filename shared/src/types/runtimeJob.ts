/**
 * 책임형 잡 러너의 와이어 계약. 백엔드와 프론트엔드가 이 한 파일을 함께 읽는다.
 *
 * 상태 정본은 `user.db` 의 `runtime_jobs` 테이블이다. SSE 힌트는 무효화 신호일 뿐이고
 * 진행률 수치를 싣지 않는다 — 정본 조회 경로는 언제나 `GET /api/jobs/:jobId` 다.
 */

export type RuntimeJobKind =
  | 'thumbnail-repair'
  | 'video-poster-backfill'
  | 'media-prompt-index'
  | 'group-auto-collect'
  | 'all-auto-collect'
  | 'auto-folder-rebuild'
  | 'folder-scan-all'
  | 'media-orphan-cleanup'
  | 'database-backup'
  | 'recycle-bin-retention'
  | 'database-compaction'
  | 'duplicate-group-scan'
  | 'auto-tag-reset'
  | 'rating-score-recalculate'
  | 'auto-tag-batch-all'
  | 'auto-tag-collection-sync'
  | 'prompt-similarity-rebuild'
  | 'file-verification'
  | 'metadata-reextract-all'
  | 'sprite-extract'
  | 'sprite-extract-batch'
  | 'sprite-normalize'
  | 'sprite-animation'
  | 'audio-export'
  | 'audio-legacy-import'
  | 'image-batch-resize'
  | 'plugin-media'
  | 'plugin-action'
  | 'plugin-llm'
  | 'plugin-task'
  | 'post-knowledge-evaluation'
  | 'post-topic-evaluation'

export type RuntimeJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export const RUNTIME_JOB_KINDS: readonly RuntimeJobKind[] = [
  'thumbnail-repair',
  'video-poster-backfill',
  'media-prompt-index',
  'group-auto-collect',
  'all-auto-collect',
  'auto-folder-rebuild',
  'folder-scan-all',
  'media-orphan-cleanup',
  'database-backup',
  'recycle-bin-retention',
  'database-compaction',
  'duplicate-group-scan',
  'auto-tag-reset',
  'rating-score-recalculate',
  'auto-tag-batch-all',
  'auto-tag-collection-sync',
  'prompt-similarity-rebuild',
  'file-verification',
  'metadata-reextract-all',
  'sprite-extract',
  'sprite-extract-batch',
  'sprite-normalize',
  'sprite-animation',
  'audio-export',
  'audio-legacy-import',
  'image-batch-resize',
  'plugin-media',
  'plugin-action',
  'plugin-llm',
  'plugin-task',
  'post-knowledge-evaluation',
  'post-topic-evaluation',
]

export const RUNTIME_JOB_TERMINAL_STATUSES: readonly RuntimeJobStatus[] = ['completed', 'failed', 'cancelled']

export interface RuntimeJobProgress {
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  /** 파생값. total === 0 이면 0. */
  percentage: number
  currentLabel: string | null
}

export interface RuntimeJobError {
  target: string
  error: string
}

export interface RuntimeJobRecord<TResult = unknown> {
  jobId: string
  kind: RuntimeJobKind
  status: RuntimeJobStatus
  phase: string | null
  progress: RuntimeJobProgress
  message: string | null
  result: TResult | null
  errors: RuntimeJobError[]
  warnings: string[]
  failureCode: string | null
  failureMessage: string | null
  cancelRequested: boolean
  queuedAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}
