import type { TestContext } from 'node:test'
import { ModelSlotStore } from '../src/services/codex-chat/modelSlots'

/**
 * Model rows for tests that run without a database: `rows` maps a row id to its [connection, model]; `defaultId` is the
 * default row (null: none). Profiles in such tests name their models by these ids (modelSlotId, summarySlotId, …).
 */
export function mockModelRows(t: TestContext, rows: Record<number, [string, string]>, defaultId: number | null = null) {
  const target = (id: number | null | undefined) => {
    const row = id === null || id === undefined ? undefined : rows[id]
    return row ? { id: id as number, providerName: row[0], model: row[1], label: `${row[0]} · ${row[1]}` } : null
  }
  t.mock.method(ModelSlotStore, 'target', target)
  t.mock.method(ModelSlotStore, 'defaultTarget', () => (defaultId === null ? null : target(defaultId)))
  t.mock.method(ModelSlotStore, 'existing', (id: unknown) => (rows[Number(id)] ? Number(id) : null))
}
