import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import express from 'express'
import { test } from 'node:test'
import { getAuthDb, initializeAuthDb } from '../src/database/authDb'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { createGenerationQueueReadRoutes } from '../src/routes/generation-queue/queue-read-routes'
import { invalidateConfiguredAuthCache } from '../src/services/auth/sessionAccess'
import type { GenerationQueueJobListRecord } from '../src/types/generationQueue'

test('one queue job is readable by its owner at any age and by nobody else', { timeout: 30000 }, async (t) => {
  // With an account present the install has auth configured, so access follows the session account, not the loopback owner.
  initializeAuthDb()
  const auth = getAuthDb()
  t.after(() => auth.close())
  const addAccount = (name: string, type: 'admin' | 'guest') => Number(auth.prepare("INSERT INTO auth_accounts (username, password_hash, account_type) VALUES (?, 'unused', ?)").run(name, type).lastInsertRowid)
  addAccount('root', 'admin')
  const owner = addAccount('owner', 'guest')
  const other = addAccount('other', 'guest')
  invalidateConfiguredAuthCache()
  const job = { id: 12818, status: 'failed', failure_message: 'node error', requested_by_account_id: owner } as GenerationQueueJobListRecord
  t.mock.method(GenerationQueueModel, 'findListRecordById', (id: number) => (id === job.id ? job : null))

  let accountId = owner
  const app = express()
  app.use((req, _res, next) => { req.session = { authenticated: true, accountId, accountType: 'guest' } as unknown as typeof req.session; next() })
  app.use('/api/generation-queue', createGenerationQueueReadRoutes())
  const server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const read = async (id: number) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/generation-queue/${id}`)
    return { status: response.status, body: await response.json() as { data?: GenerationQueueJobListRecord } }
  }

  const own = await read(12818)
  assert.equal(own.status, 200)
  assert.deepEqual([own.body.data?.status, own.body.data?.failure_message], ['failed', 'node error'])
  assert.equal((await read(99)).status, 404)
  accountId = other
  assert.equal((await read(12818)).status, 403)
})
