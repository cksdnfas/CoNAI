import type { ChatToolDirective, ChatToolDirectiveSnapshot } from '@conai/shared'

export type ResolvedChatToolDirective = { snapshot: ChatToolDirectiveSnapshot; tool: string }

export class ChatToolDirectiveError extends Error {
  constructor(message: string, readonly status = 400, readonly code: 'tool_directive_unavailable' | null = 'tool_directive_unavailable') { super(message) }
}

export function parseToolDirective(value: unknown): ChatToolDirective {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 1 && keys[0] === 'presetId' && Number.isSafeInteger(record.presetId) && (record.presetId as number) > 0) return { presetId: record.presetId as number }
    if (keys.length === 1 && keys[0] === 'tool' && typeof record.tool === 'string' && record.tool.trim()) return { tool: record.tool }
  }
  throw new ChatToolDirectiveError('도구 지시는 { presetId: 양의 정수 } 또는 { tool: 도구 이름 }으로 보내줘.')
}

export function readToolDirectiveSnapshot(value: unknown): ChatToolDirectiveSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Number.isSafeInteger(record.presetId) && (record.presetId as number) > 0 && typeof record.name === 'string' && record.tool === undefined) return { presetId: record.presetId as number, name: record.name }
  if (typeof record.tool === 'string' && record.tool.trim() && record.presetId === undefined) return { tool: record.tool }
  return undefined
}

export function toolDirectiveText(directive: ResolvedChatToolDirective | undefined): string {
  if (!directive) return ''
  const selected = 'presetId' in directive.snapshot
    ? `generation preset ${JSON.stringify(directive.snapshot.name)} (preset id ${directive.snapshot.presetId}), using tool ${JSON.stringify(directive.tool)}`
    : `tool ${JSON.stringify(directive.tool)}`
  return `User's tool selection for this turn only: carry out this request with ${selected}. Use this selected tool for the requested operation, not an alternative preset/tool. This selection does not apply to later turns and does not override permissions or tool validation.`
}
