export type ChatLoreEntry = {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
}

export function normalizeLorebook(value: unknown): ChatLoreEntry[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    let id = typeof row.id === 'string' ? row.id.trim().slice(0, 80) : ''
    if (!id || ids.has(id)) id = `lore-${index}-${ids.size}`
    while (ids.has(id)) id += '-'
    ids.add(id)
    return [{
      id,
      keys: Array.isArray(row.keys) ? [...new Set(row.keys.filter((key): key is string => typeof key === 'string').map((key) => key.trim().slice(0, 100)).filter(Boolean))].slice(0, 20) : [],
      content: typeof row.content === 'string' ? row.content.trim().slice(0, 20_000) : '',
      enabled: row.enabled !== false,
      constant: row.constant === true,
      order: typeof row.order === 'number' && Number.isFinite(row.order) ? Math.max(-10_000, Math.min(10_000, Math.round(row.order))) : index,
      caseSensitive: row.caseSensitive === true,
    }]
  })
}

/** No messages means a prompt preview: show constant entries only. Matching never evaluates regex or code. */
export function buildLorebookText(profile: { lorebook: ChatLoreEntry[]; loreScanDepth: number; loreTokenBudget: number }, messages: ReadonlyArray<{ content: string }> | undefined, estimate: (text: string) => number, render: (text: string) => string) {
  const recent = messages?.slice(-profile.loreScanDepth).map((message) => message.content).join('\n') ?? ''
  const folded = recent.toLowerCase()
  const entries = profile.lorebook.filter((entry) => entry.enabled && entry.content.trim() && (entry.constant || (messages !== undefined && entry.keys.some((key) => key && (entry.caseSensitive ? recent.includes(key) : folded.includes(key.toLowerCase())))))).sort((a, b) => a.order - b.order)
  let result = ''
  for (const entry of entries) {
    const candidate = [result, render(entry.content)].filter(Boolean).join('\n\n')
    if (estimate(candidate) <= profile.loreTokenBudget) result = candidate
  }
  return result
}
