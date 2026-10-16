/** Generation queue job lifecycle (backend and frontend both read this one). */
export type GenerationQueueJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * `status`와 직교하는 축: "업스트림에 작업을 만들었을 가능성".
 * DB CHECK 없이 앱 레벨 enum으로만 강제하므로 상수 배열/컨트랙트로 정합을 지킨다.
 */
export type GenerationQueueProviderSubmitState =
  | 'none'
  | 'in_flight'
  | 'accepted'
  | 'orphan_suspected'
  | 'orphan_unresolved'
  | 'cancel_sent'
  | 'cancel_confirmed'
  | 'cancel_unsupported'

export type GenerationQueueProgressPhase = 'preparing' | 'executing' | 'sampling' | 'finalizing'

/** Latest trusted progress sample received directly from a standard ComfyUI server. */
export interface GenerationQueueLiveProgress {
  source: 'comfyui_ws'
  phase: GenerationQueueProgressPhase
  node_id: string | null
  node_label: string | null
  value: number | null
  max: number | null
  percent: number | null
  updated_at: string
}
