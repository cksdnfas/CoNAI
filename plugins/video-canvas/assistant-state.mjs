import { fail, profilePublication, sameValue } from './domain.mjs'

// These are host transport boundaries, not limits on a canvas, prompt or operation.
export const SNAPSHOT_CHARS = 200000
export const ACTION_ERROR_CHARS = 500
const HOST_COLLECTION_ITEMS = 512
// Packaged pages cannot import host TypeScript; this wire guard follows shared/src/utils/chatPageAction.ts,
// including its exact exceptions, and is checked against the host rule in the contract tests.
const privateKey = /password|secret|credential|api[ _-]?key|authorization|bearer|token|headers|비밀번호|인증키/i
const protectedKey = key => {
  if (key === 'maxTokens' || key === 'contextTokens' || key === 'reasoningBudgetTokens') return false
  return privateKey.test(key) || ['__proto__', 'prototype', 'constructor', 'dataUrl', 'base64', 'encoded'].includes(key)
}
const hostShape = (value, depth = 0) => {
  if (depth > 20) return false
  if (Array.isArray(value)) return value.length <= HOST_COLLECTION_ITEMS && value.every(item => hostShape(item, depth + 1))
  if (value && typeof value === 'object') return Object.keys(value).length <= HOST_COLLECTION_ITEMS && Object.entries(value).filter(([, item]) => item !== undefined).every(([key, item]) => !protectedKey(key) && hostShape(item, depth + 1))
  return typeof value !== 'string' || value.length <= SNAPSHOT_CHARS && !/^data:/i.test(value.trim())
}
const size = value => JSON.stringify(value).length
const editPublication = batch => ({
  ...batch,
  ...(batch.profiles ? { profiles: batch.profiles.map(profilePublication) } : {}),
  applied: (batch.applied ?? []).map(item => ({ ...item, op: JSON.stringify(item.op) })),
  rejected: (batch.rejected ?? []).map(item => ({ ...item, op: JSON.stringify(item.op) })),
  tempIds: Object.entries(batch.tempIds ?? {}).map(([tempId, id]) => ({ tempId, id })),
})
const offsetOf = cursor => {
  if (cursor === undefined || cursor === null) return 0
  if (!/^\d+$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor))) fail('페이지 커서가 올바르지 않아.')
  return Number(cursor)
}
export function jsonPage(value, cursor, budget = SNAPSHOT_CHARS) {
  const text = JSON.stringify(value), offset = offsetOf(cursor)
  if (offset > text.length) fail('페이지 커서가 범위를 벗어났어.')
  const complete = { data: value, cursor: null, nextCursor: null }
  if (!offset && hostShape(value, 2) && size(complete) <= budget) return complete
  let low = 0, high = text.length - offset
  const result = length => ({ json: JSON.stringify(text.slice(offset, offset + length)), encoding: 'json-string', cursor: String(offset), nextCursor: offset + length < text.length ? String(offset + length) : null, totalChars: text.length })
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (size(result(mid)) <= budget) low = mid
    else high = mid - 1
  }
  if (!low && text.length > offset) fail('화면 정보 공간이 부족해. 다른 결과 페이지를 먼저 읽어줘.')
  return result(low)
}
export function recordPage(rows, { cursor, limit = rows.length || 1, budget = SNAPSHOT_CHARS / 2 } = {}) {
  const offset = offsetOf(cursor)
  if (!Number.isInteger(limit) || limit < 1 || offset > rows.length) fail('페이지 범위가 올바르지 않아.')
  const items = []
  let index = offset
  while (index < rows.length && items.length < Math.min(limit, HOST_COLLECTION_ITEMS)) {
    const candidate = rows[index]
    if (size({ items: [...items, candidate], nextCursor: String(index + 1), total: rows.length }) > budget) break
    items.push(candidate)
    index++
  }
  // A single large record is losslessly paged as JSON by the snapshot publisher.
  if (!items.length && index < rows.length && limit > 0) { items.push(rows[index]); index++ }
  return { items, cursor: String(offset), nextCursor: index < rows.length ? String(index) : null, total: rows.length }
}
export function excerpt(project, { offset, cursor = offset, edge_cursor, limit, selection = [], launch = null } = {}) {
  const nodes = recordPage(project.nodes.map(node => ({ id: node.id, kind: node.kind, status: node.data.check?.status ?? node.review })), { cursor, limit })
  const edges = recordPage(project.edges.map(({ id, from, to, port, position }) => ({ id, from, to, port, position })), { cursor: edge_cursor, limit })
  return { id: project.id, revision: project.revision, nodes: nodes.items, edges: edges.items, selection, launch,
    total: nodes.total, totalEdges: edges.total, nextCursor: nodes.nextCursor, nextEdgeCursor: edges.nextCursor, nextOffset: nodes.nextCursor === null ? null : Number(nodes.nextCursor) }
}
export function createAssistantState() {
  const sections = new Map(), cursors = new Map()
  return {
    set(name, value, summary = {}) {
      // Operation fields and tempIds are user-chosen keys, not host snapshot field names.
      if (name === 'lastEdit') value = editPublication(value)
      if (!sections.has(name) || !sameValue(sections.get(name).value, value)) cursors.delete(name)
      sections.set(name, { value, summary })
    },
    clear() { sections.clear(); cursors.clear() },
    page(name, cursor) {
      if (!sections.has(name)) fail('아직 그 작업 결과가 없어.')
      let offset
      try { offset = offsetOf(cursor) } catch { cursors.delete(name); return }
      if (offset > JSON.stringify(sections.get(name).value).length) { cursors.delete(name); return }
      cursors.set(name, String(offset))
    },
    snapshot(base, revision) {
      const data = { ...base }
      const envelope = () => ({ revision: String(revision), dirty: false, data })
      const entries = [...sections]
      for (let index = 0; index < entries.length; index++) {
        const [name, section] = entries[index]
        const metadata = size(Object.fromEntries(entries.slice(index).map(([key, entry]) => [key, { summary: entry.summary }])))
        const remaining = SNAPSHOT_CHARS - size(envelope()) - metadata - 2
        const budget = Math.floor(remaining / (entries.length - index))
        data[name] = { summary: section.summary, ...jsonPage(section.value, cursors.get(name), budget) }
      }
      if (size(envelope()) > SNAPSHOT_CHARS) fail('화면 정보가 호스트 전송 범위를 넘었어.')
      return envelope()
    },
  }
}
export function rejectedMessage(batch) {
  const prefix = `${batch.applied.length}건 적용, ${batch.rejected.length}건 거절됐어: `
  const suffix = ' · 전체 이유와 ID는 lastEdit 페이지에서 읽어줘.'
  return (prefix + batch.rejected.map(item => item.reason).join(' / ')).slice(0, ACTION_ERROR_CHARS - suffix.length) + suffix
}
export function createRefreshQueue(refresh) {
  let running = null, again = false
  return () => {
    if (running) { again = true; return running }
    running = (async () => {
      do { again = false; await refresh() } while (again)
    })().finally(() => { running = null })
    return running
  }
}
