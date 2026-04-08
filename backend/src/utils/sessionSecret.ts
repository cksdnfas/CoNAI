import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { runtimePaths } from '../config/runtimePaths'

const SESSION_SECRET_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'session-secret.txt')

/** Resolve a stable session secret from env or a persisted runtime file. */
export function resolveSessionSecret() {
  const envSecret = process.env.SESSION_SECRET?.trim()
  if (envSecret) {
    return {
      secret: envSecret,
      source: 'env' as const,
    }
  }

  if (fs.existsSync(SESSION_SECRET_FILE_PATH)) {
    const savedSecret = fs.readFileSync(SESSION_SECRET_FILE_PATH, 'utf8').trim()
    if (savedSecret) {
      console.warn('⚠️  SESSION_SECRET not set in .env, using persisted runtime secret')
      console.warn(`   Secret file: ${SESSION_SECRET_FILE_PATH}`)
      return {
        secret: savedSecret,
        source: 'file' as const,
      }
    }
  }

  const generatedSecret = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(SESSION_SECRET_FILE_PATH), { recursive: true })
  fs.writeFileSync(SESSION_SECRET_FILE_PATH, generatedSecret, { encoding: 'utf8', mode: 0o600 })

  console.warn('⚠️  SESSION_SECRET not set in .env, created persisted runtime secret')
  console.warn(`   Secret file: ${SESSION_SECRET_FILE_PATH}`)

  return {
    secret: generatedSecret,
    source: 'generated-file' as const,
  }
}
