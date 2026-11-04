// Request helpers shared by the api-codex-chat-* modules. api-codex-chat.ts re-exports only the public names, so the helpers stay internal.

import { ApiRequestError, requestApiData } from '@/lib/api-request'

export type ChatScope = 'read' | 'generate' | 'organize' | 'configure'

/** The current record returned with a rejected revision-checked save. */
export class ChatRevisionConflictError extends ApiRequestError {
  readonly current: unknown
  constructor(message: string, current: unknown) {
    super(message, 409, 'revision_conflict')
    this.current = current
  }
}

export function isChatRevisionConflict(error: unknown): error is ChatRevisionConflictError {
  return error instanceof ChatRevisionConflictError
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A revision-checked save: a stale revision becomes ChatRevisionConflictError carrying the current record. */
export async function requestRevisionChecked<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await requestApiData<T>(path, init)
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === 'revision_conflict') throw new ChatRevisionConflictError(error.message, error.data)
    throw error
  }
}
