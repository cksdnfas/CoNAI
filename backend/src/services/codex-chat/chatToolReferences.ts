const TOOL_SUMMARY_LENGTH = 600
const MAX_REFERENCES_PER_CALL = 24

type McpToolResult = { content?: unknown[]; structuredContent?: unknown } | null | undefined

export function truncateToolSummary(value: string) {
  return value.length > TOOL_SUMMARY_LENGTH ? `${value.slice(0, TOOL_SUMMARY_LENGTH)}…` : value
}

/** Pull history ids and composite hashes out of a tool result so the UI can show thumbnails. */
function collectReferences(value: unknown, historyIds: Set<number>, compositeHashes: Set<string>, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, historyIds, compositeHashes, depth + 1))
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^history_?ids?$/i.test(key)) {
      for (const id of Array.isArray(entry) ? entry : [entry]) {
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && historyIds.size < MAX_REFERENCES_PER_CALL) {
          historyIds.add(id)
        }
      }
    } else if (/^composite_?hash(es)?$/i.test(key)) {
      for (const hash of Array.isArray(entry) ? entry : [entry]) {
        if (typeof hash === 'string' && /^[0-9a-f]{16,128}$/i.test(hash) && compositeHashes.size < MAX_REFERENCES_PER_CALL) {
          compositeHashes.add(hash)
        }
      }
    } else {
      collectReferences(entry, historyIds, compositeHashes, depth + 1)
    }
  }
}

/** The text parts of an MCP tool result plus the history ids / composite hashes it mentions (JSON text or structured content). */
export function readMcpToolResult(result: McpToolResult) {
  const historyIds = new Set<number>()
  const compositeHashes = new Set<string>()
  const texts: string[] = []

  for (const content of result?.content ?? []) {
    const text = content && typeof content === 'object' ? (content as { text?: unknown }).text : undefined
    if (typeof text !== 'string') {
      continue
    }
    texts.push(text)
    try {
      collectReferences(JSON.parse(text), historyIds, compositeHashes)
    } catch {
      // Plain-text tool output carries no references.
    }
  }
  if (result?.structuredContent) {
    collectReferences(result.structuredContent, historyIds, compositeHashes)
  }

  return { texts, historyIds: [...historyIds], compositeHashes: [...compositeHashes] }
}
