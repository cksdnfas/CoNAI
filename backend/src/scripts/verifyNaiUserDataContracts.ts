import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

process.env.RUNTIME_BASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-nai-user-'))
process.env.RUNTIME_DATABASE_DIR = path.join(process.env.RUNTIME_BASE_PATH, 'database')

type ServerAddress = { port: number }

type NaiUserDataStatus = {
  connected: boolean
  reason?: string
  subscription: {
    tier: number
    active: boolean
    tierName: string
  }
  anlasBalance: number
}

async function withServer<T>(handler: express.Express, callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer(handler)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address() as ServerAddress
    return await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}

async function main() {
  const tempRoot = process.env.RUNTIME_BASE_PATH
  assert.ok(tempRoot, 'Expected temporary runtime root')

  const userSettingsDb = require('../database/userSettingsDb') as typeof import('../database/userSettingsDb')
  userSettingsDb.initializeUserSettingsDb()

  const naiUserRoutes = require('../routes/nai/user').default
  const app = express()
  app.use(express.json())
  app.use('/api/nai/user', naiUserRoutes)

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/nai/user/data`)
      assert.equal(response.status, 200, 'Missing NovelAI token must be a disconnected status, not HTTP auth failure')

      const body = await response.json() as NaiUserDataStatus
      assert.equal(body.connected, false)
      assert.equal(body.reason, 'missing_token')
      assert.equal(body.subscription.tier, 0)
      assert.equal(body.subscription.active, false)
      assert.equal(body.subscription.tierName, 'Free')
      assert.equal(body.anlasBalance, 0)
    })
  } finally {
    userSettingsDb.getUserSettingsDb().close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  console.log('✅ NAI user-data contracts verified')
}

void main()
