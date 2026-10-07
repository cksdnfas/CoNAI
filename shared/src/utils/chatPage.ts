import type { ChatPageField, ChatPageProposal, ChatPageSnapshot, ChatPageValue } from '../types/chatPage'

export const CHAT_PAGE_LIMITS = { fields: 64, changes: 24, text: 8000, options: 100, snapshot: 24000, lifetimeMs: 5 * 60_000 } as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('페이지 정보가 올바르지 않아.')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error('페이지 항목이 올바르지 않아.')
  return value
}

/** The permission is derived from an app route, never accepted from the browser. */
export function chatPagePermission(path: string): string | null {
  if (path === '/' || path === '/access' || path === '/chat') return 'page.home.view'
  if (path === '/generation') return 'page.generation.view'
  if (path === '/prompts') return 'page.prompts.view'
  if (path === '/groups' || /^\/groups\/[\w-]+$/.test(path)) return 'page.groups.view'
  if (path === '/wildcards') return 'page.wildcards.view'
  if (path === '/files') return 'page.files.view'
  if (path === '/upload') return 'page.upload.view'
  if (path === '/settings') return 'page.settings.view'
  if (/^\/images\/[\w.-]+\/metadata$/.test(path)) return 'page.metadata-editor.view'
  if (/^\/images\/[\w.-]+$/.test(path)) return 'page.image-detail.view'
  if (path === '/wallpaper') return 'page.wallpaper.view'
  if (path === '/wallpaper/runtime') return 'page.wallpaper.runtime.view'
  return null
}

/** Copy a bounded, primitive-only snapshot; unknown properties are deliberately discarded. */
export function normalizeChatPageSnapshot(value: unknown): ChatPageSnapshot {
  const raw = record(value)
  const path = text(raw.path, 240)
  if (!chatPagePermission(path)) throw new Error('이 페이지는 채팅에 연결할 수 없어.')
  const kind = raw.kind
  if (kind !== 'page' && kind !== 'nai' && kind !== 'comfyui') throw new Error('페이지 종류가 올바르지 않아.')
  if (kind !== 'page' && path !== '/generation') throw new Error('생성 입력은 생성 페이지에서만 연결할 수 있어.')
  if (!Array.isArray(raw.fields) || raw.fields.length > CHAT_PAGE_LIMITS.fields || (kind === 'page' && raw.fields.length > 0)) throw new Error('페이지 필드 목록이 올바르지 않아.')
  const ids = new Set<string>()
  const fields: ChatPageField[] = raw.fields.map((item) => {
    const field = record(item)
    const id = text(field.id, 200)
    if (ids.has(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('페이지 필드 ID가 올바르지 않아.')
    ids.add(id)
    const type = field.type
    if (type !== 'text' && type !== 'number' && type !== 'select' && type !== 'boolean') throw new Error('지원하지 않는 입력 필드야.')
    const current = field.value
    const segments = type === 'text' && Array.isArray(current) && current.length <= 32 && current.every((part) => typeof part === 'string' && part.length <= CHAT_PAGE_LIMITS.text)
    if (type === 'boolean' ? typeof current !== 'boolean' : !segments && typeof current !== 'string' && !(type === 'number' && typeof current === 'number' && Number.isFinite(current))) throw new Error('필드 값이 올바르지 않아.')
    if (typeof current === 'string' && current.length > CHAT_PAGE_LIMITS.text) throw new Error('필드 내용이 너무 길어.')
    const result: ChatPageField = { id, label: text(field.label, 160), type, value: (segments ? [...current as string[]] : current) as ChatPageValue }
    for (const bound of ['min', 'max'] as const) {
      if (field[bound] !== undefined) {
        if (typeof field[bound] !== 'number' || !Number.isFinite(field[bound])) throw new Error('숫자 범위가 올바르지 않아.')
        result[bound] = field[bound]
      }
    }
    if (result.min !== undefined && result.max !== undefined && result.min > result.max) throw new Error('숫자 범위가 올바르지 않아.')
    if (field.integer === true) result.integer = true
    if (field.allowEmpty === true) result.allowEmpty = true
    if (field.multipleOf !== undefined) {
      if (typeof field.multipleOf !== 'number' || !Number.isFinite(field.multipleOf) || field.multipleOf <= 0) throw new Error('숫자 간격이 올바르지 않아.')
      result.multipleOf = field.multipleOf
    }
    if (type === 'select') {
      if (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > CHAT_PAGE_LIMITS.options) throw new Error('선택 목록이 올바르지 않아.')
      result.options = [...new Set(field.options.map((option) => text(option, 300, true)))]
    }
    return result
  })
  const identity = (input: unknown) => {
    const id = text(input, 80)
    if (!/^[\w-]{8,80}$/.test(id)) throw new Error('페이지 연결 정보가 올바르지 않아.')
    return id
  }
  const snapshot: ChatPageSnapshot = {
    instanceId: identity(raw.instanceId), connectionId: identity(raw.connectionId), path, kind,
    title: text(raw.title, 160), resourceId: raw.resourceId === null ? null : text(raw.resourceId, 100), fields,
  }
  if (JSON.stringify(snapshot).length > CHAT_PAGE_LIMITS.snapshot) throw new Error('연결할 페이지 정보가 너무 커. 필드 내용을 줄여줘.')
  return snapshot
}

export function normalizeChatPageValue(field: ChatPageField, value: unknown): ChatPageValue {
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${field.label}: 켜기 또는 끄기 값이 필요해.`)
    return value
  }
  if (field.type === 'number') {
    if (value === '' && field.allowEmpty) return ''
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new Error(`${field.label}: 숫자가 필요해.`)
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || (field.integer && !Number.isSafeInteger(numeric)) || (field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max) || (field.multipleOf !== undefined && Math.abs(numeric / field.multipleOf - Math.round(numeric / field.multipleOf)) > 1e-8)) throw new Error(`${field.label}: 허용된 숫자 범위를 확인해줘.`)
    return typeof field.value === 'string' ? String(numeric) : numeric
  }
  const result = text(value, CHAT_PAGE_LIMITS.text, true)
  if (field.type === 'select' && !field.options?.includes(result)) throw new Error(`${field.label}: 선택 목록에 없는 값이야.`)
  return result
}

/** Validate the whole change set before any form state can change. */
export function buildChatPageChanges(page: ChatPageSnapshot, input: unknown): ChatPageProposal['changes'] {
  if (!Array.isArray(input) || input.length === 0 || input.length > CHAT_PAGE_LIMITS.changes) throw new Error('변경할 필드 목록이 올바르지 않아.')
  const seen = new Set<string>()
  const changes = input.map((item) => {
    const change = record(item)
    const field = page.fields.find((entry) => entry.id === change.fieldId)
    if (!field || seen.has(field.id)) throw new Error('등록되지 않았거나 중복된 입력 필드야.')
    seen.add(field.id)
    return { fieldId: field.id, label: field.label, before: field.value, value: normalizeChatPageValue(field, change.value) }
  }).filter((change) => change.before !== change.value)
  if (changes.length === 0) throw new Error('현재 값과 다른 변경이 없어.')
  return changes
}

/** Optimistic checks also protect undo from overwriting a later user edit. */
export function chatPagePatch(page: ChatPageSnapshot, proposal: ChatPageProposal, undo = false, now = Date.now()): Record<string, ChatPageValue> {
  if (page.instanceId !== proposal.page.instanceId || page.connectionId !== proposal.page.connectionId || page.path !== proposal.page.path || page.kind !== proposal.page.kind || page.resourceId !== proposal.page.resourceId) throw new Error('페이지나 연결이 바뀌었어. 현재 페이지에서 다시 요청해줘.')
  if (!undo && proposal.expiresAt < now) throw new Error('입력 제안의 유효 시간이 지났어. 다시 요청해줘.')
  const entries = proposal.changes.map((change) => {
    const field = page.fields.find((entry) => entry.id === change.fieldId)
    if (!field || JSON.stringify(field.value) !== JSON.stringify(undo ? change.value : change.before)) throw new Error(`${change.label}: 입력값이 바뀌었어. 덮어쓰지 않았어.`)
    return [field.id, undo ? change.before : normalizeChatPageValue(field, change.value)] as const
  })
  return Object.fromEntries(entries)
}
