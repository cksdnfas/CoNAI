import { useSyncExternalStore } from 'react'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'

/** One "load these settings" request raised from the generation history, waiting for its provider form. */
export type HistorySettingsLoadRequest = {
  nonce: number
  historyId: number
  serviceType: GenerationServiceType
  workflowId: number | null
  payload: Record<string, unknown>
}

let pendingRequest: HistorySettingsLoadRequest | null = null
let nextNonce = 1
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return pendingRequest
}

/**
 * Queue settings from a history record for the matching provider form.
 * The page switches to the provider tab/workflow and the provider panel applies and consumes it.
 */
export function requestHistorySettingsLoad(input: Omit<HistorySettingsLoadRequest, 'nonce'>) {
  pendingRequest = { ...input, nonce: nextNonce }
  nextNonce += 1
  emit()
}

/** Drop the pending request once a panel handled it (applied, declined, or failed). */
export function consumeHistorySettingsLoad(nonce: number) {
  if (pendingRequest?.nonce !== nonce) {
    return
  }

  pendingRequest = null
  emit()
}

/** Read the pending history settings load request, if any. */
export function usePendingHistorySettingsLoad() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
