import { requestApiData } from '@/lib/api-request'
import type { ChatRoutine, ChatRoutineInput } from '@conai/shared'
export type { ChatRoutine, ChatRoutineInput, ChatRoutineScheduleType, ChatRoutineTarget } from '@conai/shared'

/** A routine as the list shows it: the names of its character, room and account, and whether it is answering now. */
export type ChatRoutineView = ChatRoutine & {
  running: boolean
  profileName: string | null
  roomTitle: string | null
  roomKind: 'direct' | 'group' | null
  roomProfileId: number | null
  accountName: string | null
}

export const CHAT_ROUTINES_QUERY_KEY = ['chat-routines'] as const
export const AUTOMATION_SWITCH_QUERY_KEY = ['automation-switch'] as const

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const path = (id?: number, action?: string) => `/api/chat-routines${id === undefined ? '' : `/${id}`}${action ? `/${action}` : ''}`

export function listChatRoutines() {
  return requestApiData<ChatRoutineView[]>(path(), { cache: 'no-store' })
}

export function createChatRoutine(input: ChatRoutineInput) {
  return requestApiData<ChatRoutineView>(path(), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatRoutine(id: number, input: ChatRoutineInput) {
  return requestApiData<ChatRoutineView>(path(id), { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function setChatRoutineActive(id: number, active: boolean) {
  return requestApiData<ChatRoutine>(path(id, active ? 'resume' : 'pause'), { method: 'POST' })
}

/** Wake the routine's room once now; the outcome lands on the routine when the room has answered. */
export function runChatRoutine(id: number) {
  return requestApiData<{ id: number; started: boolean }>(path(id, 'run'), { method: 'POST' })
}

export function deleteChatRoutine(id: number) {
  return requestApiData<unknown>(path(id), { method: 'DELETE' })
}

/** The stop-everything switch for chat routines and workflow schedules. */
export function getAutomationSwitch() {
  return requestApiData<{ paused: boolean }>(path(undefined, 'switch'), { cache: 'no-store' })
}

export function setAutomationSwitch(paused: boolean) {
  return requestApiData<{ paused: boolean }>(path(undefined, 'switch'), { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ paused }) })
}
