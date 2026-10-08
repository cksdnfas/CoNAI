import type { ChatPageAction, ChatPageActionProposal, ChatPageData, ChatPageSchema } from '../types/chatPageAction'
import type { ChatPageSnapshot } from '../types/chatPage'

// Node schemas include nested properties/enums inside a page collection; schema recursion stays capped at eight.
export const CHAT_PAGE_ACTION_LIMITS = { actions: 24, bytes: 320000, text: 200000, depth: 20, array: 512 } as const
function own(value: object, key: PropertyKey) { return Object.prototype.hasOwnProperty.call(value, key) }
const privateKey = /password|secret|credential|api[ _-]?key|authorization|bearer|token|headers|(?:file|source|output|save|artifact)[ _-]?(?:path|directory)|(?:^|[_.-])(?:code|script|url|endpoint)(?:$|[_.-])|filename_prefix|비밀번호|인증키|저장.?경로/i
export function isPrivateChatPageKey(key: string) { return privateKey.test(key) || ['__proto__', 'prototype', 'constructor', 'dataUrl', 'base64', 'encoded'].includes(key) }

/** Copy only bounded JSON. Media and protected settings stay in the native page, outside model context. */
export function copyChatPageData(value: unknown, depth = 0): ChatPageData {
  if (depth > CHAT_PAGE_ACTION_LIMITS.depth) throw new Error('페이지 데이터가 너무 깊어.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length <= CHAT_PAGE_ACTION_LIMITS.text && !/^data:|^https?:\/\//i.test(value.trim())) return value
  if (Array.isArray(value) && value.length <= CHAT_PAGE_ACTION_LIMITS.array) return value.map((item) => copyChatPageData(item, depth + 1))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 512) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (isPrivateChatPageKey(key)) throw new Error(`보호된 페이지 항목이야: ${key}`)
      return [key, copyChatPageData(item, depth + 1)]
    }))
  }
  throw new Error('지원하지 않는 페이지 데이터야.')
}

export function normalizeChatPageSchema(input: unknown, depth = 0): ChatPageSchema {
  const raw = input as ChatPageSchema
  if (!raw || depth > 8 || !['string', 'number', 'boolean', 'object', 'array'].includes(raw.type)) throw new Error('작업 입력 정의가 올바르지 않아.')
  const schema: ChatPageSchema = { type: raw.type }
  if (raw.description !== undefined) { if (typeof raw.description !== 'string' || raw.description.length > 500) throw new Error('작업 설명이 너무 길어.'); schema.description = raw.description }
  for (const key of ['minimum', 'maximum', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (raw[key] !== undefined) { if (!Number.isFinite(raw[key]) || (key !== 'minimum' && key !== 'maximum' && raw[key]! < 0)) throw new Error('작업 입력 범위가 올바르지 않아.'); schema[key] = raw[key] }
  }
  if (raw.integer) schema.integer = true
  if (raw.enum) { if (!Array.isArray(raw.enum) || !raw.enum.length || raw.enum.length > 512 || raw.enum.some((item) => typeof item !== 'string' && typeof item !== 'number')) throw new Error('작업 선택 목록이 올바르지 않아.'); schema.enum = [...raw.enum] }
  if (raw.type === 'object') {
    if (!raw.properties || Object.keys(raw.properties).length > 100) throw new Error('작업 필드 정의가 올바르지 않아.')
    schema.properties = Object.fromEntries(Object.entries(raw.properties).map(([key, item]) => { if (isPrivateChatPageKey(key)) throw new Error('보호된 작업 필드야.'); return [key, normalizeChatPageSchema(item, depth + 1)] }))
    schema.required = raw.required ?? []
    if (!Array.isArray(schema.required) || schema.required.some((key) => !own(schema.properties!, key))) throw new Error('필수 작업 필드가 올바르지 않아.')
  }
  if (raw.type === 'array') schema.items = normalizeChatPageSchema(raw.items, depth + 1)
  return schema
}

export function validateChatPageArguments(schema: ChatPageSchema, input: unknown, path = 'arguments'): ChatPageData {
  let value = input
  // Local models sometimes serialize a structured argument as JSON. Only decode where the schema requires it.
  if ((schema.type === 'object' || schema.type === 'array') && typeof value === 'string') { try { value = JSON.parse(value) } catch { throw new Error(`${path}: JSON 입력이 필요해.`) } }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 객체가 필요해.`)
    const entries = Object.entries(value)
    if (entries.some(([key]) => !own(schema.properties ?? {}, key)) || schema.required?.some((key) => !own(value!, key))) throw new Error(`${path}: 등록된 필드와 필수 입력을 확인해줘.`)
    return Object.fromEntries(entries.map(([key, item]) => [key, validateChatPageArguments(schema.properties![key], item, `${path}.${key}`)]))
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > Math.min(schema.maxItems ?? 512, 512)) throw new Error(`${path}: 항목 개수가 올바르지 않아.`)
    return value.map((item, index) => validateChatPageArguments(schema.items!, item, `${path}[${index}]`))
  }
  if (typeof value !== schema.type || (schema.type === 'string' && (value as string).length > Math.min(schema.maxLength ?? 8000, CHAT_PAGE_ACTION_LIMITS.text)) || (schema.type === 'number' && (!Number.isFinite(value) || (schema.integer && !Number.isSafeInteger(value)) || (schema.minimum !== undefined && (value as number) < schema.minimum) || (schema.maximum !== undefined && (value as number) > schema.maximum))) || (schema.enum && !schema.enum.includes(value as string | number))) throw new Error(`${path}: 입력 형식이나 허용 범위를 확인해줘.`)
  return copyChatPageData(value)
}

/** IDs and route bindings are maintained by the app; snapshots cannot grant arbitrary native actions. */
export const CHAT_PAGE_ACTION_PERMISSIONS: Record<string, string | null> = {
  'page.navigate': null, 'page.refresh': null,
  'prompt.create': 'prompts.edit', 'prompt.update': 'prompts.edit', 'prompt.select': 'prompts.view',
  'preset.create': 'prompts.edit', 'preset.update': 'prompts.edit', 'preset.select': 'prompts.view', 'preset.draft': 'prompts.view', 'preset.insert': 'prompts.view',
  'wildcard.create': 'wildcards.edit', 'wildcard.update': 'wildcards.edit', 'wildcard.select': 'wildcards.view', 'wildcard.draft': 'wildcards.view',
  'comfy.select': 'workflows.view', 'comfy.refresh': 'workflows.view', 'comfy.open_create': 'workflows.edit', 'comfy.open_edit': 'workflows.edit',
  'comfy.author': 'workflows.view', 'comfy.save': 'workflows.edit', 'comfy.register': 'workflows.edit', 'comfy.node': null,
  'media.attach': null, 'media.clear': null,
  'nai.characters': null,
  'workflow.select': 'workflows.view', 'workflow.inputs': 'workflows.view',
}
export function chatPageActionAllowed(path: string, id: string): boolean {
  if (!own(CHAT_PAGE_ACTION_PERMISSIONS, id)) return false
  if (id.startsWith('page.')) return true
  if (id.startsWith('prompt.') || id === 'preset.create' || id === 'preset.update' || id === 'preset.select' || id === 'preset.draft') return path === '/prompts'
  if (id.startsWith('wildcard.')) return path === '/wildcards'
  if (id === 'media.attach' || id === 'media.clear' || id === 'preset.insert') return path === '/generation' || /^\/public\/workflows\/[\w-]+$/.test(path)
  if (['comfy.node', 'comfy.refresh', 'comfy.open_create', 'comfy.open_edit', 'comfy.author', 'comfy.register', 'comfy.save'].includes(id)) return path === '/generation' || /^\/public\/workflows\/[\w-]+$/.test(path)
  return path === '/generation'
}
export function normalizeChatPageActions(path: string, input: unknown): ChatPageAction[] {
  if (!Array.isArray(input) || input.length > CHAT_PAGE_ACTION_LIMITS.actions) throw new Error('페이지 작업 목록이 올바르지 않아.')
  const ids = new Set<string>()
  return input.map((raw: ChatPageAction) => {
    if (!chatPageActionAllowed(path, raw?.id) || ids.has(raw.id) || typeof raw.label !== 'string' || !raw.label || raw.label.length > 160 || typeof raw.description !== 'string' || raw.description.length > 1000 || !['draft', 'save'].includes(raw.effect)) throw new Error('등록되지 않았거나 잘못된 페이지 작업이야.')
    ids.add(raw.id)
    const saves = ['prompt.create', 'prompt.update', 'preset.create', 'preset.update', 'wildcard.create', 'wildcard.update', 'comfy.save', 'comfy.register']
    if ((raw.effect === 'save') !== saves.includes(raw.id)) throw new Error('작업의 저장 범위가 올바르지 않아.')
    const schema = normalizeChatPageSchema(raw.schema)
    if (schema.type !== 'object') throw new Error('작업 인수는 객체여야 해.')
    return { id: raw.id, label: raw.label, description: raw.description, effect: raw.effect, schema }
  })
}
export function requireChatPageActionState(page: ChatPageSnapshot, proposal: ChatPageActionProposal) {
  if (proposal.expiresAt < Date.now() || page.revision !== proposal.revision) throw new Error('페이지 입력이나 선택이 바뀌었거나 제안이 만료됐어. 다시 요청해줘.')
  const action = page.actions?.find((item) => item.id === proposal.action.id)
  if (!action || JSON.stringify(normalizeChatPageActions(page.path, [action])[0]) !== JSON.stringify(normalizeChatPageActions(page.path, [proposal.action])[0])) throw new Error('현재 페이지에서 사용할 수 없는 작업이야.')
  validateChatPageArguments(action.schema, proposal.arguments)
}
