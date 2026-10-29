import { createHash, createHmac, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Request, Response } from 'express'
import { runtimePaths } from '../config/runtimePaths'

/** Hash the complete native record, including children/items and private settings, without disclosing it. */
export function nativeEditRevision(record: unknown) {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'children' && key !== 'assistant_revision').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
      if (['marked_fields', 'public_queue_role_limits', 'synonyms'].includes(key) && typeof item === 'string') { try { item = JSON.parse(item) } catch { /* retain malformed legacy data */ } }
      return [key, stable(item)]
    }))
  }
  return createHash('sha256').update(JSON.stringify(stable(record))).digest('hex')
}

const settingsRevisionKeyPath = path.join(runtimePaths.basePath, 'config', 'settings-revision-secret.txt')
let settingsRevisionKey: string | undefined

/** Install one domain-separated key atomically, including when several server processes start together. */
function getSettingsRevisionKey() {
  if (settingsRevisionKey) return settingsRevisionKey
  const readKey = () => {
    const key = fs.readFileSync(settingsRevisionKeyPath, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid settings revision key')
    return key
  }
  try {
    return (settingsRevisionKey = readKey())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const directory = path.dirname(settingsRevisionKeyPath)
  fs.mkdirSync(directory, { recursive: true })
  let sessionSecret = process.env.SESSION_SECRET?.trim()
  if (!sessionSecret) {
    try {
      sessionSecret = fs.readFileSync(path.join(directory, 'session-secret.txt'), 'utf8').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const candidate = sessionSecret
    ? createHmac('sha256', sessionSecret).update('conai:settings-revision:v1').digest('hex')
    : randomBytes(32).toString('hex')
  const temporary = path.join(directory, `.settings-revision-${randomBytes(16).toString('hex')}.tmp`)
  fs.writeFileSync(temporary, candidate, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    try { fs.linkSync(temporary, settingsRevisionKeyPath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Volumes without hard links (FAT32/exFAT, some network shares) create the key exclusively instead.
        try { fs.writeFileSync(settingsRevisionKeyPath, candidate, { encoding: 'utf8', flag: 'wx', mode: 0o600 }) }
        catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError }
      }
    }
  } finally {
    fs.unlinkSync(temporary)
  }
  // A process that created the key exclusively may still be writing it: wait briefly for the whole value.
  for (let attempt = 0; ; attempt += 1) {
    try { return (settingsRevisionKey = readKey()) }
    catch (error) {
      if (attempt >= 20) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
}

/** Settings can contain arbitrary nested keys, including `children`; none may be excluded. */
export function nativeSettingsRevision(record: unknown) {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  }
  return createHmac('sha256', getSettingsRevisionKey()).update(JSON.stringify(stable(record))).digest('hex')
}
export function withNativeEditRevisions<T extends object>(records: T[]): Array<T & { assistant_revision: string }> {
  return records.map((item) => {
    const children = (item as { children?: T[] }).children
    return { ...item, assistant_revision: nativeEditRevision(item), ...(children ? { children: withNativeEditRevisions(children) } : {}) }
  })
}
/** Optional optimistic concurrency for reviewed writes. Check immediately before the synchronous native mutation. */
export function requireNativeEditRevision(req: Request, res: Response, record: unknown): boolean {
  const expected = req.get('If-Match')
  if (expected && expected !== nativeEditRevision(record)) { res.status(409).json({ success: false, code: 'revision_conflict', error: '다른 작업에서 저장한 내용이 바뀌었어. 새로 읽고 다시 제안받아줘.' }); return false }
  return true
}
