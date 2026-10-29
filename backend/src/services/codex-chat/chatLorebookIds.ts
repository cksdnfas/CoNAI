import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'

/** The canonical title/body used by normalization and exact identity matching across source formats. */
export function loreEntryText(row: Record<string, unknown>) {
  const title = typeof row.title === 'string' ? row.title : typeof row.comment === 'string' ? row.comment : ''
  const content = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : ''
  // Trimmed again after the cut, so normalizing a normalized value changes nothing (exact matching relies on it).
  return { title: title.trim().replace(/\s+/g, ' ').slice(0, 80).trim(), content: content.trim().slice(0, 20_000).trimEnd() }
}

function normalizedId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 80).trim() : ''
}

/** Mutate only IDs. Id-less replacements claim identical existing title/body pairs, in stored order. */
export function stampLoreEntryIds(entries: unknown[], existing: ReadonlyArray<{ id: string; title: string; content: string }> = [], createId: () => string = randomUUID): boolean {
  const seen = new Set<string>()
  // Explicit IDs have priority even when an id-less entry appears before them in the input.
  const explicit = new Set(entries.flatMap((entry) => entry && typeof entry === 'object' && 'id' in entry ? [normalizedId(entry.id)] : []))
  const reserved = new Set([...explicit, ...existing.map((entry) => normalizedId(entry.id))])
  const matching = new Map<string, { ids: string[]; next: number }>()
  const textKey = (row: Record<string, unknown>) => JSON.stringify(loreEntryText(row))
  for (const entry of existing) {
    const key = textKey(entry)
    const bucket = matching.get(key) ?? { ids: [], next: 0 }
    bucket.ids.push(normalizedId(entry.id))
    matching.set(key, bucket)
  }
  let changed = false
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    let id = normalizedId(row.id)
    if (!id) {
      const bucket = matching.get(textKey(row))
      while (bucket && bucket.next < bucket.ids.length) {
        const candidate = bucket.ids[bucket.next++]
        if (candidate && !seen.has(candidate) && !explicit.has(candidate)) { id = candidate; break }
      }
    }
    if (!id || seen.has(id)) {
      do { id = createId() } while (reserved.has(id))
      reserved.add(id)
    }
    if (row.id !== id) {
      row.id = id
      changed = true
    }
    seen.add(id)
  }
  return changed
}

/** One database pass, not a write on every read. File sources are stamped by their existing reconciliation path. */
export function migrateLoreEntryIds(db: Database.Database) {
  const name = 'permanent_lore_entry_ids_v1'
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM chat_settings_migrations WHERE name = ?').get(name)) return
    const update = db.prepare('UPDATE chat_lorebooks SET entries = ? WHERE id = ?')
    for (const row of db.prepare('SELECT id, entries FROM chat_lorebooks').all() as Array<{ id: number; entries: string }>) {
      let entries: unknown
      try { entries = JSON.parse(row.entries) } catch { continue }
      if (Array.isArray(entries) && stampLoreEntryIds(entries)) update.run(JSON.stringify(entries), row.id)
    }
    db.prepare('INSERT INTO chat_settings_migrations (name) VALUES (?)').run(name)
  }).immediate()
}
