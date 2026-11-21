import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appliedLore } from '../src/features/codex-chat/chat-context-info'
import type { ChatContextLore, ChatContextMeta } from '../src/lib/api-codex-chat'

const base: ChatContextMeta = { model: null, windowFromMessageId: null, sentMessages: 2, summaryUntilMessageId: null, recalledSegments: 0, lore: [], memories: 0, estimatedTokens: 10 }
const entry = (title: string, reason: string, matched: string[] = []): ChatContextLore => ({ key: `1:${title}`, bookId: 1, bookKind: 'global', entryId: title, title, selected: true, reason, matched })

test('the lore key counts the entries a reply applied, and shows only where lorebooks were searched', () => {
  // No record, or a chat with no lorebook candidates: no key.
  assert.equal(appliedLore(null), null)
  assert.equal(appliedLore(base), null)
  assert.equal(appliedLore({ ...base, version: 2, scope: 'view', loreEntries: [], loreSkipped: [], loreUnmatched: 0 }), null)
  // A search that matched nothing still shows, as 0.
  assert.deepEqual(appliedLore({ ...base, version: 2, scope: 'view', loreEntries: [], loreSkipped: [], loreUnmatched: 134 }), [])
  const v2 = appliedLore({
    ...base, version: 2, scope: 'view', lore: ['Hanta Sero', 'Class 1-A'], loreUnmatched: 134,
    loreEntries: [entry('Hanta Sero', 'key:Sero', ['Sero', '1-A']), entry('Class 1-A', 'semantic')],
    loreSkipped: [{ bookId: 1, entryId: 'Bakugo', title: 'Bakugo', reason: 'budget' }],
  })
  assert.deepEqual(v2?.map(({ title, reason, matched }) => [title, reason, matched]), [['Hanta Sero', 'key:Sero', ['Sero', '1-A']], ['Class 1-A', 'semantic', []]])
})

test('a session reply counts lore it already holds; a viewer without the v2 view gets the v1 titles alone', () => {
  const skipped = [{ bookId: 1, entryId: 'Sero', title: 'Hanta Sero', reason: 'codex-sent' }, { bookId: 1, entryId: 'Aizawa', title: 'Aizawa', reason: 'cooldown' }]
  const session = appliedLore({ ...base, version: 2, scope: 'view', engine: 'codex', opaqueContext: true, loreEntries: [entry('Class 1-A', 'key:1-A', ['1-A'])], loreSkipped: skipped, loreUnmatched: 3 })
  assert.deepEqual(session?.map(({ title, reason }) => [title, reason]), [['Class 1-A', 'key:1-A'], ['Hanta Sero', 'codex-sent']])
  // Outside a session "already sent" is not a reason the server gives; nothing skipped counts there.
  const direct = appliedLore({ ...base, version: 2, scope: 'view', engine: 'llm', loreEntries: [], loreSkipped: skipped, loreUnmatched: 0 })
  assert.deepEqual(direct, [])
  // Diagnostics off (or no diagnostics permission) leaves the v1 record: titles, no reasons, nothing when empty.
  assert.deepEqual(appliedLore({ ...base, lore: ['Hanta Sero'] })?.map(({ title, reason }) => [title, reason]), [['Hanta Sero', '']])
  assert.deepEqual(appliedLore({ ...base, version: 2, scope: 'none', lore: ['Hanta Sero'], loreEntries: [entry('Hanta Sero', 'key:Sero')] })?.map(({ reason }) => reason), [''])
})
