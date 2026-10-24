import { randomUUID } from 'node:crypto'
import type { LlmPresetRecord } from '@conai/shared'

export function normalizeStructuredOutputJson(value: unknown, options: { mode?: 'strict-write' | 'tolerant-migration'; errorMessage?: string } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return JSON.stringify(JSON.parse(value.trim()), null, 2)
  } catch {
    if (options.mode === 'tolerant-migration') return null
    throw new Error(options.errorMessage ?? '구조화 출력 JSON 양식이 올바른 JSON이 아니야')
  }
}

/** Preset writes and settings imports share parsing, but retain their error and timestamp policies. */
export function normalizeLlmPresetRecord(value: unknown, options: {
  mode: 'strict-write' | 'tolerant-migration'; label?: string; valueType?: 'text' | 'json'; contentKey?: string; now?: string
}): LlmPresetRecord | null {
  const strict = options.mode === 'strict-write'
  const label = options.label ?? ''
  if (!value || typeof value !== 'object') {
    if (strict) throw new Error(`${label} 항목은 객체여야 해.`)
    return null
  }
  const record = value as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' ? value : ''
  const id = text(record.id).trim() || (strict ? randomUUID() : '')
  const name = text(record.name).trim()
  if (!name && strict) throw new Error(`${label}에는 이름이 필요해.`)
  const raw = record[options.contentKey ?? 'content']
  const content = options.valueType === 'json'
    ? normalizeStructuredOutputJson(raw, { mode: options.mode, errorMessage: '구조화 출력 JSON 양식은 올바른 JSON이어야 해.' }) ?? ''
    : text(raw)
  if (!content.trim() && strict) throw new Error(`${label} '${name}' 에 저장할 내용이 비어 있어.`)
  if (!id || !name || !content.trim()) return null
  const date = (value: unknown, fallback: string) => {
    const parsed = typeof value === 'string' && value.trim() ? Date.parse(value.trim()) : NaN
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
  }
  const now = options.now ?? new Date().toISOString()
  const createdAt = date(record.createdAt, now)
  return { id, name, content, createdAt, updatedAt: strict ? now : date(record.updatedAt, createdAt) }
}
