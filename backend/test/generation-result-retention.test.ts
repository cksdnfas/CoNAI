import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiGenDb, initializeApiGenerationDb } from '../src/database/apiGenerationDb'
import { initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { pruneGenerationResultRetention } from '../src/services/generationResultRetentionService'

initializeUserSettingsDb()
initializeApiGenerationDb()

test('history retention yields between batches, keeps active jobs and removes only oldest terminal rows', async () => {
  const insert = apiGenDb.prepare("INSERT INTO api_generation_history (service_type, generation_status) VALUES ('novelai', ?)")
  const pendingId = Number(insert.run('pending').lastInsertRowid)
  const processingId = Number(insert.run('processing').lastInsertRowid)
  let firstTerminalId = 0
  let lastTerminalId = 0
  apiGenDb.transaction(() => {
    for (let index = 0; index < 1105; index += 1) {
      const id = Number(insert.run(index % 2 === 0 ? 'completed' : 'failed').lastInsertRowid)
      if (index === 0) firstTerminalId = id
      lastTerminalId = id
    }
  })()

  let yielded = false
  setImmediate(() => { yielded = true })
  const report = await pruneGenerationResultRetention(100)
  assert.deepEqual(report, {
    retention_limit: 100,
    active_count: 2,
    retained_terminal_count: 98,
    deleted_count: 1007,
    remaining_overflow_count: 0,
    batch_count: 2,
  })
  assert.equal(yielded, true)
  const readStatus = apiGenDb.prepare('SELECT generation_status FROM api_generation_history WHERE id = ?')
  assert.deepEqual(readStatus.get(pendingId), { generation_status: 'pending' })
  assert.deepEqual(readStatus.get(processingId), { generation_status: 'processing' })
  assert.equal(readStatus.get(firstTerminalId), undefined)
  assert.ok(readStatus.get(lastTerminalId))
  assert.deepEqual(apiGenDb.prepare('SELECT COUNT(*) AS total FROM api_generation_history').get(), { total: 100 })

  const repeated = await pruneGenerationResultRetention(100)
  assert.equal(repeated.deleted_count, 0)
  assert.equal(repeated.remaining_overflow_count, 0)
  assert.equal(repeated.batch_count, 1)
})
