import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/**
 * PAYLOAD-3: content-addressed store for base64 image inputs.
 *
 * The "개수" control submits the same img2img payload up to 32 times. Inline base64
 * meant 32 × 5MB of JSON parsed by express, serialized by the model and written into
 * 32 rows. Here the decoded bytes are hashed once, written to one file, and every job
 * keeps a small reference instead.
 *
 * Lifetime is refcounted in `generation_queue_input_refs` (migration 032) and released
 * by `pruneTerminalRequestPayloads` — the same moment a job stops being retryable.
 * See `releaseQueueInputsForJobs` for why that anchor (rather than "job is terminal")
 * is the safe one.
 *
 * Backward compatibility (plan §1-8): nothing here rewrites existing rows. Payloads that
 * still carry inline `dataUrl` values keep working through the untouched base64 branch in
 * `prepareComfyPromptData`, which is why this module never has to migrate old jobs.
 */

export const QUEUE_INPUT_REF_KIND = 'queue-input'

/** Blobs below this size are not worth a file + refcount row; they stay inline. */
const MIN_EXTERNALIZED_INPUT_BYTES = 8 * 1024

/** Guard against pathological nesting in an untrusted JSON body. */
const MAX_PAYLOAD_WALK_DEPTH = 12

/** Grace period before an unreferenced file is treated as crash debris rather than an in-flight enqueue. */
const ORPHAN_SWEEP_GRACE_MS = 60 * 60 * 1000

const DATA_URL_PATTERN = /^data:([a-zA-Z0-9.+/-]+)?;base64,/

/** Stay well under SQLite's bind-parameter ceiling when releasing a large prune batch. */
const RELEASE_JOB_ID_CHUNK_SIZE = 500

export type QueueInputRef = {
  __ref: typeof QUEUE_INPUT_REF_KIND
  sha256: string
  bytes: number
  mimeType?: string
  fileName?: string
}

/** Path keys `prepareComfyPromptData` already resolves; such a field needs no externalization. */
const EXISTING_PATH_KEYS = ['storagePath', 'originalPath', 'original_file_path', 'filePath', 'path'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Recognize one stored queue input reference. */
export function isQueueInputRef(value: unknown): value is QueueInputRef {
  return isPlainObject(value)
    && value.__ref === QUEUE_INPUT_REF_KIND
    && typeof value.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.sha256)
}

/** Root directory for stored queue inputs. Deliberately outside `temp/`, which is served statically. */
export function getQueueInputStoreDir() {
  return path.join(runtimePaths.basePath, 'queue-inputs')
}

/** Absolute on-disk location for one content hash (sharded so no directory grows unbounded). */
export function resolveQueueInputPath(sha256: string) {
  return path.join(getQueueInputStoreDir(), sha256.slice(0, 2), `${sha256}.bin`)
}

/** Resolve a stored reference to a readable file path, or null when the blob is gone. */
export function resolveQueueInputFilePath(ref: QueueInputRef) {
  const absolutePath = resolveQueueInputPath(ref.sha256)
  return fs.existsSync(absolutePath) ? absolutePath : null
}

/**
 * Write one decoded input to the store and return its reference.
 * Writing is idempotent: an identical blob (same hash) is stored exactly once, which is what
 * makes a 32-way duplicate submission cost one file instead of 32.
 */
export function storeQueueInputBuffer(buffer: Buffer, options: { mimeType?: string; fileName?: string } = {}): QueueInputRef {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const absolutePath = resolveQueueInputPath(sha256)

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    // Write to a unique temp name and rename, so a crash mid-write can never leave a
    // truncated file sitting at the address its hash promises.
    const stagingPath = `${absolutePath}.${process.pid}.${Date.now()}.part`
    fs.writeFileSync(stagingPath, buffer)
    try {
      fs.renameSync(stagingPath, absolutePath)
    } catch (error) {
      // A concurrent enqueue may have landed the identical blob first; that is a success.
      if (!fs.existsSync(absolutePath)) {
        throw error
      }
      fs.rmSync(stagingPath, { force: true })
    }
  }

  return {
    __ref: QUEUE_INPUT_REF_KIND,
    sha256,
    bytes: buffer.byteLength,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
    ...(options.fileName ? { fileName: options.fileName } : {}),
  }
}

/** Decode one base64 data URL, or null when the value is not one (or is too small to be worth a file). */
function decodeDataUrl(value: string) {
  const match = DATA_URL_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const base64 = value.slice(match[0].length)
  // 4 base64 chars encode 3 bytes; skip the decode entirely for values that cannot clear the floor.
  if (base64.length * 3 / 4 < MIN_EXTERNALIZED_INPUT_BYTES) {
    return null
  }

  const buffer = Buffer.from(base64, 'base64')
  if (buffer.byteLength < MIN_EXTERNALIZED_INPUT_BYTES) {
    return null
  }

  return { buffer, mimeType: match[1] || undefined }
}

/**
 * Replace base64 image inputs inside one prompt payload with stored references.
 *
 * Values that already point at a file (`storagePath` and friends) are left alone — they are
 * references too, just to a different store. Anything that is not a large base64 data URL is
 * returned untouched, so this is safe to run over an arbitrary prompt_data shape.
 */
export function externalizeQueueInputDataUrls<T>(value: T): { value: T; refs: QueueInputRef[] } {
  const refs: QueueInputRef[] = []

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > MAX_PAYLOAD_WALK_DEPTH) {
      return node
    }

    if (typeof node === 'string') {
      const decoded = decodeDataUrl(node)
      if (!decoded) {
        return node
      }

      const ref = storeQueueInputBuffer(decoded.buffer, { mimeType: decoded.mimeType })
      refs.push(ref)
      return ref
    }

    if (Array.isArray(node)) {
      return node.map((entry) => walk(entry, depth + 1))
    }

    if (!isPlainObject(node)) {
      return node
    }

    // An image field object: `{ dataUrl, fileName?, mimeType? }`.
    if (typeof node.dataUrl === 'string' && !EXISTING_PATH_KEYS.some((key) => typeof node[key] === 'string' && (node[key] as string).trim().length > 0)) {
      const decoded = decodeDataUrl(node.dataUrl)
      if (decoded) {
        const ref = storeQueueInputBuffer(decoded.buffer, {
          mimeType: typeof node.mimeType === 'string' ? node.mimeType : decoded.mimeType,
          fileName: typeof node.fileName === 'string' ? node.fileName : undefined,
        })
        refs.push(ref)
        return ref
      }
    }

    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(node)) {
      next[key] = walk(entry, depth + 1)
    }
    return next
  }

  return { value: walk(value, 0) as T, refs }
}

/** Collect every stored reference inside one payload object. */
export function collectQueueInputRefs(value: unknown): QueueInputRef[] {
  const refs: QueueInputRef[] = []

  const walk = (node: unknown, depth: number) => {
    if (depth > MAX_PAYLOAD_WALK_DEPTH || node === null || typeof node !== 'object') {
      return
    }

    if (isQueueInputRef(node)) {
      refs.push(node)
      return
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry, depth + 1)
      }
      return
    }

    for (const entry of Object.values(node as Record<string, unknown>)) {
      walk(entry, depth + 1)
    }
  }

  walk(value, 0)
  return refs
}

/**
 * Record one job's claim on every input it references.
 * Called from `GenerationQueueModel.create`, so every enqueue path — user routes, public
 * workflow routes, graph executors and retries — registers its claims without knowing about it.
 */
export function registerQueueInputRefs(jobId: number, refs: QueueInputRef[]) {
  if (refs.length === 0) {
    return 0
  }

  const db = getUserSettingsDb()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO generation_queue_input_refs (job_id, sha256, byte_size)
    VALUES (?, ?, ?)
  `)

  let inserted = 0
  for (const ref of refs) {
    inserted += insert.run(jobId, ref.sha256, ref.bytes ?? 0).changes
  }

  return inserted
}

/**
 * Drop the given jobs' claims and delete any input that nobody references any more.
 *
 * Callers must only pass jobs whose payload has just been compacted. That is the point where a
 * job can no longer be retried (`retryJob` rejects pruned payloads), which is the real end of an
 * input's usefulness — a merely terminal job may still be retried, and an `orphan_suspected`
 * job is not terminal at all, so neither is a safe deletion anchor.
 */
export function releaseQueueInputsForJobs(jobIds: number[]) {
  if (jobIds.length === 0) {
    return { releasedFiles: 0, releasedBytes: 0 }
  }

  const db = getUserSettingsDb()
  // A cold backlog can compact far more jobs than SQLite's bind-parameter ceiling allows.
  const chunks: number[][] = []
  for (let index = 0; index < jobIds.length; index += RELEASE_JOB_ID_CHUNK_SIZE) {
    chunks.push(jobIds.slice(index, index + RELEASE_JOB_ID_CHUNK_SIZE))
  }

  const candidateShaSet = new Set<string>()
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(', ')
    for (const row of db.prepare(`
      SELECT DISTINCT sha256 FROM generation_queue_input_refs
      WHERE job_id IN (${placeholders})
    `).all(...chunk) as Array<{ sha256: string }>) {
      candidateShaSet.add(row.sha256)
    }
  }

  const candidateShas = [...candidateShaSet]
  if (candidateShas.length === 0) {
    return { releasedFiles: 0, releasedBytes: 0 }
  }

  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(', ')
    db.prepare(`DELETE FROM generation_queue_input_refs WHERE job_id IN (${placeholders})`).run(...chunk)
  }

  const stillReferenced = db.prepare(`SELECT 1 FROM generation_queue_input_refs WHERE sha256 = ? LIMIT 1`)
  let releasedFiles = 0
  let releasedBytes = 0

  for (const sha256 of candidateShas) {
    if (stillReferenced.get(sha256)) {
      continue
    }

    const absolutePath = resolveQueueInputPath(sha256)
    try {
      const size = fs.statSync(absolutePath).size
      fs.rmSync(absolutePath, { force: true })
      releasedFiles += 1
      releasedBytes += size
    } catch {
      // Already gone (or never written); the refcount row is what mattered.
    }
  }

  return { releasedFiles, releasedBytes }
}

/**
 * Delete stored inputs that no job claims.
 *
 * Covers the one window the refcount cannot: a crash between writing the blob and inserting the
 * refcount row. The mtime grace keeps it from racing an enqueue that is still assembling its jobs.
 */
export function sweepOrphanQueueInputFiles(options: { graceMs?: number } = {}) {
  const storeDir = getQueueInputStoreDir()
  if (!fs.existsSync(storeDir)) {
    return { scanned: 0, removed: 0, removedBytes: 0 }
  }

  const graceMs = Math.max(0, options.graceMs ?? ORPHAN_SWEEP_GRACE_MS)
  const cutoff = Date.now() - graceMs
  const db = getUserSettingsDb()
  const isReferenced = db.prepare(`SELECT 1 FROM generation_queue_input_refs WHERE sha256 = ? LIMIT 1`)

  let scanned = 0
  let removed = 0
  let removedBytes = 0

  for (const shard of fs.readdirSync(storeDir, { withFileTypes: true })) {
    if (!shard.isDirectory()) {
      continue
    }

    const shardDir = path.join(storeDir, shard.name)
    for (const entry of fs.readdirSync(shardDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      scanned += 1
      const absolutePath = path.join(shardDir, entry.name)

      try {
        const stats = fs.statSync(absolutePath)
        if (stats.mtimeMs > cutoff) {
          continue
        }

        // `.part` staging files are always debris once they are older than the grace period.
        const sha256 = entry.name.endsWith('.bin') ? entry.name.slice(0, -'.bin'.length) : null
        if (sha256 && isReferenced.get(sha256)) {
          continue
        }

        fs.rmSync(absolutePath, { force: true })
        removed += 1
        removedBytes += stats.size
      } catch {
        // Concurrent removal; nothing to do.
      }
    }
  }

  return { scanned, removed, removedBytes }
}
